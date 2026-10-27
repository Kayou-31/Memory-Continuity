"""Characterize the real pinned SDK against local HTTP, not a paid model.

These tests demonstrate why an entry hook is insufficient and that a dedicated
HTTP-client guard can cover retries. They do not implement the core admission lease.
"""
import asyncio
from contextlib import contextmanager
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]


@contextmanager
def offline():
    original, original_ex = socket.socket.connect, socket.socket.connect_ex
    def wrap(method):
        def call(sock, address):
            if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1'):
                raise RuntimeError('only the local test terminal is permitted')
            return method(sock, address)
        return call
    socket.socket.connect, socket.socket.connect_ex = wrap(original), wrap(original_ex)
    try:
        # httpx can inherit Windows registry proxies even with no HTTP_PROXY
        # environment variable. The synthetic endpoint must stay on loopback,
        # never be forwarded through the user's proxy. Restore both on exit.
        with patch.dict(os.environ, {'NO_PROXY': '127.0.0.1,::1', 'no_proxy': '127.0.0.1,::1'}):
            yield
    finally:
        socket.socket.connect, socket.socket.connect_ex = original, original_ex


class ProviderBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        sdk = Path(os.environ['MEMCONT_ASTRBOT_SOURCE']).resolve()
        sys.path.insert(0, str(sdk))
        os.environ.setdefault('ASTRBOT_ROOT', str(ROOT / 'work/task8-host/provider' / str(uuid4())))
        self.network = offline()
        self.network.__enter__()
        self.addCleanup(self.network.__exit__, None, None, None)
        import astrbot
        self.assertEqual(astrbot.__version__, '4.29.3')
        self.assertTrue(Path(astrbot.__file__).resolve().is_relative_to(sdk))
        from aiohttp import web
        from astrbot.core.provider.sources.openai_source import ProviderOpenAIOfficial
        self.Provider = ProviderOpenAIOfficial
        self.requests = []
        self.failure = (500, 'synthetic retry')
        async def endpoint(request):
            self.requests.append(await request.json())
            if len(self.requests) == 1:
                return web.json_response({'error': {'message': self.failure[1], 'type': 'test_error'}}, status=self.failure[0])
            return web.json_response({'id': 'offline', 'object': 'chat.completion', 'created': 1, 'model': 'offline',
                                      'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'offline'}, 'finish_reason': 'stop'}]})
        app = web.Application()
        app.router.add_post('/v1/chat/completions', endpoint)
        runner = web.AppRunner(app)
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        site = web.TCPSite(runner, '127.0.0.1', 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.config = {'id': 'memory-test', 'type': 'openai_chat_completion', 'key': ['offline-not-a-real-key'],
                       'model': 'offline', 'api_base': f'http://127.0.0.1:{port}/v1', 'timeout': 5, 'proxy': ''}

    async def test_one_provider_entry_can_send_multiple_http_requests(self):
        provider = self.Provider(self.config, {})
        self.addAsyncCleanup(provider.client.close)
        await provider.text_chat(prompt='合成测试', request_max_retries=2)
        self.assertEqual(len(self.requests), 2)

    async def test_disabling_inner_retry_does_not_disable_context_error_retry(self):
        self.failure = (400, 'maximum context length')
        provider = self.Provider(self.config, {})
        self.addAsyncCleanup(provider.client.close)
        await provider.text_chat(prompt='合成测试', contexts=[{'role': 'user', 'content': '旧消息'},
                                                          {'role': 'assistant', 'content': '旧回应'}], request_max_retries=1)
        self.assertEqual(len(self.requests), 2)
        self.assertNotEqual(self.requests[0]['messages'], self.requests[1]['messages'])

    async def test_dedicated_http_client_can_block_retry_before_second_network_send(self):
        import httpx
        class GuardedProvider(self.Provider):
            checks = 0
            def _create_http_client(self, config):
                async def check(request):
                    self.checks += 1
                    if self.checks > 1:
                        raise asyncio.CancelledError('synthetic admission revoked')
                return httpx.AsyncClient(trust_env=False, event_hooks={'request': [check]})
        provider = GuardedProvider(self.config, {})
        self.addAsyncCleanup(provider.client.close)
        with self.assertRaises(asyncio.CancelledError):
            await provider.text_chat(prompt='合成测试', request_max_retries=2)
        self.assertEqual(provider.checks, 2)
        self.assertEqual(len(self.requests), 1, 'revoked retry must not reach the HTTP terminal')
