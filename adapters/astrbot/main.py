"""Explicit local management bridge. Model injection is intentionally unavailable."""
import asyncio
from astrbot import __version__ as astrbot_version
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star
from astrbot.core.platform.message_type import MessageType
from .core_client import CoreClient, CoreError


class MemoryContinuity(Star):
    def __init__(self, context: Context, config):
        super().__init__(context, config)
        self.config = config
        self.client = None
        self._sessions = {}
        self._lock = asyncio.Lock()
        self._retired = False

    async def _disconnect(self):
        client, self.client = self.client, None
        self._sessions.clear()
        if client:
            await client.close()

    @filter.command('memcont')
    async def memcont(self, event: AstrMessageEvent, action: str = 'status', binding: str = ''):
        """管理员私聊：connect / status / open <binding> / close。"""
        event.stop_event()
        if not event.is_admin():
            yield event.plain_result('这个入口仅供 AstrBot 管理员使用。')
            return
        if event.get_message_type() is not MessageType.FRIEND_MESSAGE or event.get_group_id():
            yield event.plain_result('请在管理员私聊中操作；管理地址不会发到群里。')
            return
        if self._retired or self.config.get('enabled') is not True:
            yield event.plain_result('Memory-Continuity 管理桥未启用。请先在插件设置中启用，再显式连接。')
            return
        if astrbot_version != '4.29.3':
            yield event.plain_result('当前开发桥仅验收 AstrBot 4.29.3，请先核对版本；没有读取或修改记忆。')
            return
        async with self._lock:
            try:
                if self._retired:
                    raise CoreError('ownership_lost')
                if action == 'connect':
                    await self._disconnect()
                    candidate = CoreClient(self.config.get('connection_file', ''))
                    try:
                        status = await candidate.status()
                        if self._retired:
                            raise CoreError('ownership_lost')
                    except BaseException:
                        await candidate.close()
                        raise
                    self.client = candidate
                    message = f'已连接本机 Memory-Continuity 核心，可用绑定 {len(status["bindings"])} 个。模型注入尚未开放。'
                elif action == 'close':
                    await self._disconnect()
                    message = '已断开管理桥，并尝试撤销本桥的临时管理会话；没有停止独立核心服务。'
                elif action == 'status':
                    if self.client is None:
                        message = '未连接核心。先在本机显式启动核心服务并配置连接文件，再发送 /memcont connect。'
                    else:
                        status = await self.client.status()
                        message = '核心已连接。可用绑定：' + '、'.join(status['bindings']) + '。模型注入尚未开放；没有自动写记忆或压缩。'
                elif action == 'open':
                    if self.client is None:
                        raise CoreError('not_connected')
                    if not binding:
                        yield event.plain_result('用法：/memcont open <绑定ID>。先用 /memcont status 查看配置中的绑定。')
                        return
                    key = (event.get_platform_id(), event.get_self_id(), event.get_sender_id())
                    old = self._sessions.pop(key, None)
                    if old:
                        await self.client.revoke(old)
                    session = await self.client.session(binding)
                    self._sessions[key] = session
                    opened = await self.client.workbench(session)
                    message = '本机工作台（含临时管理凭据，请勿转发）：\n' + opened['url'] + '\n只能在运行核心的电脑上打开，最长十分钟有效。保存前仍须预览确认。'
                else:
                    message = '可用指令：/memcont connect、/memcont status、/memcont open <绑定ID>、/memcont close。当前仅开放管理桥，模型注入尚未开放。'
                if self._retired:
                    raise CoreError('ownership_lost')
                yield event.plain_result(message)
            except CoreError as error:
                yield event.plain_result('Memory-Continuity 操作未完成（' + error.code + '）。请核对核心状态和连接文件；不会自动重连、重发或放宽权限。')
            except (OSError, ValueError, TypeError):
                yield event.plain_result('Memory-Continuity 配置或响应无效，请在本机检查。敏感配置不会发到聊天里。')

    async def terminate(self):
        self._retired = True
        await self._disconnect()
