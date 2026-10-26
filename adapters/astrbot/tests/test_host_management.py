"""Real AstrBot plugin loader + core HTTP, with no model or account transport.

Unused host services are deliberately absent; this is component integration,
not an Electron/UI/QQ or complete AstrBot lifecycle claim.
"""
import asyncio
import faulthandler
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import zipfile
from uuid import uuid4
from test_core_client import CoreFixture, ROOT


class HostManagementTests(CoreFixture):
    async def test_real_loader_private_admin_controls_and_unload(self):
        source = ROOT / 'adapters/astrbot'
        self.assertTrue((source / 'main.py').exists(), 'real AstrBot plugin entry is required')
        sdk = Path(os.environ['MEMCONT_ASTRBOT_SOURCE']).resolve()
        sandbox = ROOT / 'work/task8-host/native' / str(uuid4())
        sandbox.mkdir(parents=True)
        diagnostic = (sandbox / 'import-stack.log').open('w', encoding='utf-8')
        self.addCleanup(diagnostic.close)
        faulthandler.dump_traceback_later(45, file=diagnostic)
        self.addCleanup(faulthandler.cancel_dump_traceback_later)
        os.environ['ASTRBOT_ROOT'] = str(sandbox)
        sys.path[:0] = [str(sandbox), str(sdk)]
        # Reject external sockets even if a host import or loader tries to use one.
        connect, connect_ex = socket.socket.connect, socket.socket.connect_ex
        attempts = []
        def guarded(method):
            def call(sock, address):
                if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1'):
                    attempts.append(address[0])
                    raise RuntimeError('offline host validation blocks external sockets')
                return method(sock, address)
            return call
        socket.socket.connect = guarded(connect)
        socket.socket.connect_ex = guarded(connect_ex)
        self.addCleanup(setattr, socket.socket, 'connect', connect)
        self.addCleanup(setattr, socket.socket, 'connect_ex', connect_ex)
        import astrbot
        self.assertEqual(astrbot.__version__, '4.29.3')
        self.assertTrue(Path(astrbot.__file__).resolve().is_relative_to(sdk))
        from astrbot.core import astrbot_config, db_helper, sp
        from astrbot.api.star import Context
        from astrbot.core.star.star_manager import PluginManager
        from astrbot.core.star.star import star_map
        from astrbot.core.star.star_handler import star_handlers_registry, EventType
        from astrbot.core.platform.astr_message_event import AstrMessageEvent
        from astrbot.core.platform.astrbot_message import AstrBotMessage, MessageMember
        from astrbot.core.platform.platform_metadata import PlatformMetadata
        from astrbot.core.platform.message_type import MessageType
        from astrbot.core.message.components import Plain
        faulthandler.cancel_dump_traceback_later()
        await db_helper.initialize()
        self.addAsyncCleanup(db_helper.engine.dispose)
        from astrbot.core.astrbot_config_mgr import AstrBotConfigManager
        from astrbot.core.umop_config_router import UmopConfigRouter
        from astrbot.core.persona_mgr import PersonaManager
        from astrbot.core.provider.manager import ProviderManager
        router = UmopConfigRouter(sp)
        await router.initialize()
        config_manager = AstrBotConfigManager(astrbot_config, router, sp)
        await config_manager.initialize()
        persona_manager = PersonaManager(db_helper, config_manager)
        provider_manager = ProviderManager(config_manager, db_helper, persona_manager)
        self.assertEqual(provider_manager.inst_map, {}, 'no model endpoint is installed in this management fixture')
        context = Context(event_queue=asyncio.Queue(), config=astrbot_config, db=db_helper,
                          provider_manager=provider_manager, platform_manager=None, conversation_manager=None,
                          message_history_manager=None, persona_manager=persona_manager, astrbot_config_mgr=config_manager,
                          knowledge_base_manager=None, cron_manager=None)
        name = 'astrbot_plugin_memory_continuity'
        destination = sandbox / 'data/plugins' / name
        destination.mkdir(parents=True)
        artifact = sandbox / 'adapter.zip'
        built = subprocess.run([sys.executable, str(ROOT / 'scripts/build-astrbot.py'), '--out', str(artifact)],
                               cwd=ROOT, capture_output=True, text=True, timeout=20)
        self.assertEqual(built.returncode, 0, built.stderr)
        with zipfile.ZipFile(artifact) as package:
            self.assertIsNone(package.testzip())
            self.assertTrue(all('/' not in name and '\\' not in name for name in package.namelist()))
            package.extractall(destination)
        config_dir = sandbox / 'data/config'
        config_dir.mkdir(exist_ok=True)
        (config_dir / (name + '_config.json')).write_text(json.dumps({'enabled': True, 'connection_file': str(self.connection)}), encoding='utf-8')
        manager = PluginManager(context, astrbot_config)
        loaded, error = await manager.load(specified_dir_name=name)
        self.assertTrue(loaded, str(error))
        metadata = star_map['data.plugins.' + name + '.main']
        plugin = metadata.star_cls
        self.addAsyncCleanup(manager._terminate_plugin, metadata)
        handlers = star_handlers_registry.get_handlers_by_module_name(metadata.module_path)
        self.assertEqual(len(handlers), 1)
        self.assertEqual(handlers[0].event_type, EventType.AdapterMessageEvent)
        from astrbot.core.pipeline.context import PipelineContext
        from astrbot.core.pipeline.scheduler import PipelineScheduler
        from astrbot.core.pipeline.process_stage.stage import ProcessStage
        from astrbot.core.pipeline.result_decorate.stage import ResultDecorateStage
        from astrbot.core.pipeline.respond.stage import RespondStage
        pipeline_context = PipelineContext(astrbot_config, manager, 'offline', db_helper)
        pipeline = PipelineScheduler(pipeline_context)
        for stage_type in (ProcessStage, ResultDecorateStage, RespondStage):
            stage = stage_type()
            await stage.initialize(pipeline_context)
            pipeline.stages.append(stage)

        class CapturedEvent(AstrMessageEvent):
            # Only the terminal is substituted: no platform account or telemetry.
            # Scheduling, handler invocation, decoration and sending are real SDK.
            async def send(self, message):
                self.sent.append(message.get_plain_text())
                self._has_send_oper = True

        def event(admin=True, group=False):
            message = AstrBotMessage()
            message.type = MessageType.GROUP_MESSAGE if group else MessageType.FRIEND_MESSAGE
            message.self_id, message.sender = '80001', MessageMember('90001', '合成管理员')
            message.message_id, message.session_id = str(uuid4()), '90001'
            message.message, message.message_str = [Plain('/memcont')], '/memcont'
            message.group_id = '70001' if group else ''
            value = CapturedEvent('/memcont', message, PlatformMetadata('aiocqhttp', 'offline fixture', 'onebot-test'), '90001')
            value.role = 'admin' if admin else 'member'
            value.sent = []
            value.is_at_or_wake_command = True
            return value

        async def command(action, binding='', **options):
            message = event(**options)
            message.set_extra('activated_handlers', handlers)
            message.set_extra('handlers_parsed_params', {handlers[0].handler_full_name: {'action': action, 'binding': binding}})
            await pipeline.execute(message)
            self.assertTrue(message.is_stopped(), 'management commands must not fall through into an LLM')
            self.assertEqual(len(message.sent), 1, 'the actual pipeline must deliver exactly one management reply')
            return message.sent[0]

        self.assertIn('管理员', await command('connect', admin=False))
        self.assertIn('私聊', await command('connect', group=True))
        self.assertIsNone(plugin.client, 'untrusted commands must not open the credential file')
        self.assertIn('未连接', await command('status'))
        self.assertIn('已连接', await command('connect'))
        text = await command('status')
        self.assertIn('模型注入尚未开放', text)
        self.assertNotIn(json.loads(self.connection.read_bytes())['adminToken'], text)
        opened = await command('open', 'main')
        self.assertIn('http://127.0.0.1:', opened)
        self.process.stdin.write(b'expire\n')
        await self.process.stdin.drain()
        self.assertEqual(json.loads(await self.process.stdout.readline()), {'expired': True})
        self.assertIn('http://127.0.0.1:', await command('open', 'main'), 'first explicit open after expiry must succeed')
        self.assertNotIn('http://', await command('open', 'main', group=True))
        self.assertEqual(len((await self.client.status())['sessions']), 1)
        await manager._terminate_plugin(metadata)
        self.assertEqual((await self.client.status())['sessions'], [])
        self.assertEqual(attempts, [])
