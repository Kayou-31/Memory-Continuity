import asyncio
import importlib
import json
import os
from pathlib import Path
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]


class CoreFixture(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        try:
            self.api = importlib.import_module('adapters.astrbot.core_client')
        except ModuleNotFoundError:
            self.fail('AstrBot needs an independent core client')
        self.process = await asyncio.create_subprocess_exec(
            os.environ['MEMCONT_TEST_NODE'], str(ROOT / 'test/fixtures/core/astrbot-service.mjs'),
            cwd=ROOT, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.addAsyncCleanup(self.cleanup_core)
        line = await asyncio.wait_for(self.process.stdout.readline(), 20)
        self.connection = Path(json.loads(line)['connectionFile'])
        self.client = self.api.CoreClient(self.connection)

    async def cleanup_core(self):
        if hasattr(self, 'client'):
            await self.client.close()
        if hasattr(self, 'process') and self.process.returncode is None:
            self.process.stdin.write(b'quit\n')
            await self.process.stdin.drain()
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
                self.fail('core service did not stop normally')
            self.assertEqual(self.process.returncode, 0, (await self.process.stderr.read()).decode())


class CoreClientTests(CoreFixture):
    async def test_failed_revoke_keeps_cleanup_record_until_explicit_close(self):
        session = await self.client.session('main')
        await self.client.workbench(session)
        self.process.stdin.write(b'saturate\n')
        await self.process.stdin.drain()
        self.assertEqual(json.loads(await self.process.stdout.readline()), {'saturated': True})
        try:
            with self.assertRaises(self.api.CoreError) as raised:
                await self.client.revoke(session)
            self.assertEqual(raised.exception.code, 'capacity_exceeded')
            with self.assertRaises(self.api.CoreError) as raised:
                await self.client.search(session, '林澈')
            self.assertEqual(raised.exception.code, 'ownership_lost')
        finally:
            self.process.stdin.write(b'release\n')
            await self.process.stdin.drain()
            self.assertEqual(json.loads(await self.process.stdout.readline()), {'released': True})
        inspector = self.api.CoreClient(self.connection)
        self.addAsyncCleanup(inspector.close)
        self.assertEqual(len((await inspector.status())['sessions']), 1)
        await self.client.close()
        self.assertEqual((await inspector.status())['sessions'], [], 'failed revoke must remain eligible for later explicit cleanup')

    async def test_revoke_of_expired_session_requires_confirmed_absence_then_allows_new_open(self):
        session = await self.client.session('main')
        await self.client.workbench(session)
        self.process.stdin.write(b'expire\n')
        await self.process.stdin.drain()
        self.assertEqual(json.loads(await self.process.stdout.readline()), {'expired': True})
        self.assertEqual(await self.client.revoke(session), {'revoked': True})
        replacement = await self.client.session('main')
        self.assertNotEqual(session.session_id, replacement.session_id)
        self.assertIn('http://127.0.0.1:', (await self.client.workbench(replacement))['url'])

    async def test_real_core_read_and_revision_receipt(self):
        status = await self.client.status()
        self.assertIs(status['modelDispatch'], False)
        one = await self.client.session('main')
        two = await self.client.session('main')
        reply = await self.client.search(one, '林澈')
        self.assertGreater(len(reply['result']['items']), 0)
        await self.client.verify(one, reply['receiptId'])
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.verify(two, reply['receiptId'])
        self.assertEqual(raised.exception.code, 'scope_denied')
        self.process.stdin.write(b'rename\n')
        await self.process.stdin.drain()
        self.assertEqual(json.loads(await self.process.stdout.readline()), {'renamed': True})
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.verify(one, reply['receiptId'])
        self.assertEqual(raised.exception.code, 'stale_input')
        latest = await self.client.search(one, '林川')
        self.assertGreater(len(latest['result']['items']), 0)

    async def test_revocation_and_client_retirement_do_not_reissue_capabilities(self):
        session = await self.client.session('main')
        await self.client.revoke(session)
        with self.assertRaises(self.api.CoreError):
            await self.client.search(session, '林澈')
        self.assertEqual((await self.client.status())['sessions'], [])
        await self.client.close()
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.session('main')
        self.assertEqual(raised.exception.code, 'ownership_lost')

    async def test_connection_replacement_is_not_automatic_reauthorization(self):
        session = await self.client.session('main')
        original = self.connection.read_bytes()
        config = json.loads(original)
        config['instanceId'] = str(uuid4())
        self.connection.write_text(json.dumps(config), encoding='utf-8')
        try:
            with self.assertRaises(self.api.CoreError) as raised:
                await self.client.search(session, '林澈')
            self.assertEqual(raised.exception.code, 'ownership_lost')
        finally:
            self.connection.write_bytes(original)
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.search(session, '林澈')
        self.assertEqual(raised.exception.code, 'ownership_lost', 'restoring old bytes must not revive a retired client')

    async def test_missing_connection_cannot_revive_after_file_is_restored(self):
        session = await self.client.session('main')
        original = self.connection.read_bytes()
        self.connection.unlink()
        try:
            with self.assertRaises(self.api.CoreError) as raised:
                await self.client.search(session, '林澈')
            self.assertEqual(raised.exception.code, 'core_unavailable')
        finally:
            self.connection.write_bytes(original)
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.search(session, '林澈')
        self.assertEqual(raised.exception.code, 'ownership_lost')

    async def test_connection_validation_refuses_remote_urls_and_malformed_credentials(self):
        original = json.loads(self.connection.read_bytes())
        invalid = self.connection.with_name('invalid.json')
        for change in [{'url': 'https://example.invalid'}, {'url': 'http://localhost:80'},
                       {'url': 'http://127.0.0.1:80/path'}, {'url': 'http://127.0.0.1:80#x'},
                       {'adminToken': 'short'}, {'schemaVersion': 2}, {'extra': True}]:
            invalid.write_text(json.dumps(original | change), encoding='utf-8')
            with self.subTest(change=change), self.assertRaises(self.api.CoreError):
                self.api.CoreClient(invalid)
        secret = original['adminToken']
        self.assertNotIn(secret, repr(self.client))
        self.assertNotIn(secret, repr(await self.client.session('main')))

    async def test_transport_failure_retires_old_handles_without_reconnect(self):
        session = await self.client.session('main')
        self.process.stdin.write(b'disconnect\n')
        await self.process.stdin.drain()
        self.assertEqual(json.loads(await self.process.stdout.readline()), {'disconnected': True})
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.search(session, '林澈')
        self.assertEqual(raised.exception.code, 'core_unavailable')
        with self.assertRaises(self.api.CoreError) as raised:
            await self.client.status()
        self.assertEqual(raised.exception.code, 'ownership_lost')


if __name__ == '__main__':
    unittest.main()
