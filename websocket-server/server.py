import asyncio
import contextlib
import json
import logging
from datetime import datetime
from pathlib import Path
from aiohttp import web

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / 'public'
CONNECTED = set()

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s')

async def send_broadcast(payload, origin=None):
    text = json.dumps(payload, ensure_ascii=False)
    for ws in set(CONNECTED):
        if ws.closed:
            CONNECTED.discard(ws)
            continue
        try:
            if ws is origin:
                await ws.send_str(json.dumps({**payload, 'selfEcho': True}, ensure_ascii=False))
            else:
                await ws.send_str(text)
        except Exception:
            CONNECTED.discard(ws)

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    CONNECTED.add(ws)
    welcome = {
        'type': 'info',
        'message': '接続しました',
        'timestamp': datetime.utcnow().isoformat()
    }
    await ws.send_str(json.dumps(welcome, ensure_ascii=False))
    logging.info('client connected, total=%d', len(CONNECTED))

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                payload = msg.data.strip()
                logging.info('受信: %s', payload)
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    await ws.send_str(json.dumps({
                        'type': 'error',
                        'message': 'JSONではありません',
                        'raw': payload
                    }, ensure_ascii=False))
                    continue

                await send_broadcast({
                    'type': 'broadcast',
                    'origin': 'client',
                    'timestamp': datetime.utcnow().isoformat(),
                    'body': data
                }, origin=ws)
            elif msg.type == web.WSMsgType.ERROR:
                logging.error('WebSocket error: %s', ws.exception())
    finally:
        CONNECTED.discard(ws)
        logging.info('client disconnected, total=%d', len(CONNECTED))
    return ws

async def index_handler(request):
    return web.FileResponse(PUBLIC_DIR / 'index.html')

async def health(request):
    return web.json_response({'status': 'ready', 'clients': len(CONNECTED)})

async def periodic_server_time():
    while True:
        await asyncio.sleep(10)
        if not CONNECTED:
            continue
        payload = {
            'type': 'heartbeat',
            'timestamp': datetime.utcnow().isoformat()
        }
        await send_broadcast(payload)

async def start_background(app):
    app['heartbeat'] = asyncio.create_task(periodic_server_time())

async def stop_background(app):
    app['heartbeat'].cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app['heartbeat']

app = web.Application()
app.router.add_get('/', index_handler)
app.router.add_get('/ws', websocket_handler)
app.router.add_get('/health', health)
app.router.add_static('/static/', path=PUBLIC_DIR, name='static')
app.on_startup.append(start_background)
app.on_cleanup.append(stop_background)

if __name__ == '__main__':
    web.run_app(app, port=3000)
