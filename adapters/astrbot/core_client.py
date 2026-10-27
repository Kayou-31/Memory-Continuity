"""Bounded loopback client; the TypeScript core remains the only memory store.

Administrative credentials stay here. No automatic reconnect, reauthorization,
retry, memory import, or model request is performed by this module.
"""
import asyncio
from dataclasses import dataclass, field
import hashlib
import http.client
import json
from pathlib import Path
import re
import stat
import threading
from urllib.parse import urlsplit
from uuid import UUID


class CoreError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__('Memory-Continuity: ' + code)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def _json(data):
    return json.loads(data, object_pairs_hook=_object)


def _read_connection(path: Path):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > 4096:
            raise CoreError('invalid_connection')
        with path.open('rb') as handle:
            data = handle.read(4097)
        if len(data) > 4096:
            raise CoreError('invalid_connection')
        return data
    except OSError as exc:
        raise CoreError('core_unavailable') from exc


@dataclass(frozen=True, repr=False, eq=False)
class CoreSession:
    session_id: str
    expires_at: str
    _tool_token: str = field(repr=False)

    def __repr__(self):
        return '<Memory-Continuity session>'


class CoreClient:
    def __init__(self, connection_file: str | Path, *, timeout: float = 5):
        self._path = Path(connection_file)
        if not self._path.is_absolute() or not 0.1 <= timeout <= 10:
            raise CoreError('invalid_connection')
        raw = _read_connection(self._path)
        try:
            value = _json(raw)
            if not isinstance(value, dict) or set(value) != {'schemaVersion', 'instanceId', 'pid', 'url', 'adminToken'}:
                raise ValueError()
            if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
                raise ValueError()
            if type(value['pid']) is not int or value['pid'] <= 0:
                raise ValueError()
            UUID(value['instanceId'])
            url = urlsplit(value['url'])
            if (url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port
                    or url.username or url.password or url.path or url.query or url.fragment
                    or value['url'] != f'http://127.0.0.1:{url.port}'):
                raise ValueError()
            if not isinstance(value['adminToken'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['adminToken']):
                raise ValueError()
        except (ValueError, TypeError, AttributeError) as exc:
            raise CoreError('invalid_connection') from exc
        self._port = url.port
        self._admin = value['adminToken']
        self._fingerprint = hashlib.sha256(raw).digest()
        self._timeout = timeout
        self._retired = False
        self._closing = None
        self._sessions = {}
        self._pending_revocations = {}
        self._opening = 0
        self._connections = set()
        self._lock = threading.Lock()

    def __repr__(self):
        return '<Memory-Continuity loopback client>'

    def _active(self, *, cleanup=False):
        if self._retired and not cleanup:
            raise CoreError('ownership_lost')
        try:
            current = _read_connection(self._path)
        except CoreError:
            self._retired = True
            raise
        if hashlib.sha256(current).digest() != self._fingerprint:
            self._retired = True
            raise CoreError('ownership_lost')

    def _session(self, session):
        self._active()
        if not isinstance(session, CoreSession) or self._sessions.get(session.session_id) is not session:
            raise CoreError('ownership_lost')

    def _request(self, route, payload, token=None, *, cleanup=False):
        self._active(cleanup=cleanup)
        try:
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        except (TypeError, ValueError) as exc:
            raise CoreError('invalid_request') from exc
        if len(body) > 131072:
            raise CoreError('capacity_exceeded')
        connection = http.client.HTTPConnection('127.0.0.1', self._port, timeout=self._timeout)
        with self._lock:
            self._active(cleanup=cleanup)
            self._connections.add(connection)
        try:
            connection.request('POST', route, body, {'Authorization': 'Bearer ' + (token or self._admin), 'Content-Type': 'application/json'})
            response = connection.getresponse()
            if response.status not in (200, 403, 408, 409, 413, 429) or response.getheader('Content-Type', '').split(';')[0] != 'application/json':
                raise CoreError('invalid_response')
            data = response.read(131073)
            if len(data) > 131072:
                raise CoreError('capacity_exceeded')
            self._active(cleanup=cleanup)
            try:
                value = _json(data)
                if not isinstance(value, dict) or type(value.get('ok')) is not bool:
                    raise ValueError()
                if value['ok']:
                    if response.status != 200 or set(value) != {'ok', 'value'}:
                        raise ValueError()
                    return value['value']
                code = value.get('code')
                if not isinstance(code, str) or not re.fullmatch(r'[a-z_]{1,64}', code):
                    raise ValueError()
                # Do not relay arbitrary server text or credentials into a chat/log.
                raise CoreError(code)
            except (ValueError, UnicodeError) as exc:
                raise CoreError('invalid_response') from exc
        except (OSError, http.client.HTTPException) as exc:
            self._retired = True
            raise CoreError('core_unavailable') from exc
        finally:
            with self._lock:
                self._connections.discard(connection)
            connection.close()

    async def _call(self, route, payload, token=None, *, cleanup=False):
        return await asyncio.to_thread(self._request, route, payload, token, cleanup=cleanup)

    async def status(self):
        return await self._call('/v1/admin/status', {})

    async def session(self, binding_id: str):
        self._active()
        if len(self._sessions) + len(self._pending_revocations) + self._opening >= 16:
            raise CoreError('capacity_exceeded')
        self._opening += 1
        try:
            value = await self._call('/v1/admin/session', {'bindingId': binding_id})
            if (not isinstance(value, dict) or set(value) != {'sessionId', 'toolToken', 'expiresAt'}
                    or not isinstance(value['sessionId'], str) or not re.fullmatch(r'[a-f0-9]{48}', value['sessionId'])
                    or not isinstance(value['toolToken'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['toolToken'])
                    or not isinstance(value['expiresAt'], str)):
                raise CoreError('invalid_response')
            self._active()
            session = CoreSession(value['sessionId'], value['expiresAt'], value['toolToken'])
            self._sessions[session.session_id] = session
            return session
        finally:
            self._opening -= 1

    async def search(self, session: CoreSession, query: str, *, limit: int = 4):
        self._session(session)
        result = await self._call('/v1/tool/search', {'query': query, 'limit': limit}, session._tool_token)
        self._session(session)
        return result

    async def verify(self, session: CoreSession, receipt_id: str):
        self._session(session)
        result = await self._call('/v1/admin/verify', {'sessionId': session.session_id, 'receiptId': receipt_id})
        self._session(session)
        return result

    async def workbench(self, session: CoreSession):
        self._session(session)
        result = await self._call('/v1/admin/workbench', {'sessionId': session.session_id, 'host': 'astrbot'})
        self._session(session)
        return result

    async def revoke(self, session: CoreSession):
        self._session(session)
        del self._sessions[session.session_id]
        self._pending_revocations[session.session_id] = session
        try:
            result = await self._call('/v1/admin/revoke', {'sessionId': session.session_id})
        except CoreError as error:
            if error.code != 'scope_denied':
                raise
            # The core sweeps expired sessions before handling revoke. Confirm
            # absence with the same authenticated instance, not a local clock.
            status = await self.status()
            sessions = status.get('sessions') if isinstance(status, dict) else None
            if not isinstance(sessions, list) or any(
                not isinstance(item, dict) or not isinstance(item.get('sessionId'), str)
                or not re.fullmatch(r'[a-f0-9]{48}', item['sessionId']) for item in sessions
            ):
                raise CoreError('invalid_response')
            if any(item['sessionId'] == session.session_id for item in sessions):
                raise error
            result = {'revoked': True}
        if not isinstance(result, dict) or set(result) != {'revoked'} or result['revoked'] is not True:
            raise CoreError('invalid_response')
        self._pending_revocations.pop(session.session_id, None)
        return result

    async def close(self):
        if self._closing:
            await self._closing
            return
        self._retired = True
        sessions = list(self._sessions.values()) + list(self._pending_revocations.values())
        self._sessions.clear()
        self._pending_revocations.clear()
        with self._lock:
            for connection in tuple(self._connections):
                connection.close()

        async def cleanup():
            # At most four cleanup requests at once; no reconnect or retries.
            limit = asyncio.Semaphore(4)
            async def revoke(session):
                async with limit:
                    try:
                        await self._call('/v1/admin/revoke', {'sessionId': session.session_id}, cleanup=True)
                    except CoreError:
                        pass  # A disconnected core cannot be repaired by the client.
            await asyncio.gather(*(revoke(session) for session in sessions))
        self._closing = asyncio.create_task(cleanup())
        await self._closing
