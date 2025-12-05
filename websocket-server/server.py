import asyncio
import contextlib
import json
import logging
from datetime import datetime
from pathlib import Path

import aiohttp
from aiohttp import web

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / 'public'
CONNECTED = set()

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s')

OLLAMA_ENDPOINT = 'http://ollama-no-gpu:11434/api/generate'
OLLAMA_MODEL = 'gemma3:4b'
SCHEMA_PATH = ROOT_DIR / 'message-schema.json'
with open(SCHEMA_PATH, encoding='utf-8') as schema_file:
    MESSAGE_SCHEMA_TEXT = schema_file.read().strip()

OLLAMA_PROMPT = """You are Jarvis controlling a 6-axis robot arm. Each joint controls:
- j1: Base yaw (rotation, -180 to 180 degrees)
- j2: Root pitch (torso tilt, 0 to 180 degrees, 90 equals a horizontal Y-axis alignment; higher is upward)
- j3: Elbow pitch (0 to 150 degrees)
- j4: Wrist pitch (-130 to 130 degrees)
- j5: Roll (-180 to 180 degrees)
- j6: Gripper open/close (0 to 100 percent)
Take this schema and craft a JSON payload that conforms to it, based on the user's short command.
Schema:
{schema}
Command: "{command}"
Respond with JSON only (no explanation)."""

async def query_ollama_payload(command: str) -> dict | None:
    prompt = OLLAMA_PROMPT.replace('{command}', command).replace('{schema}', MESSAGE_SCHEMA_TEXT)
    timeout = aiohttp.ClientTimeout(total=60)
    try:
        logging.info('Sending request to Ollama with prompt: %s', prompt)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                OLLAMA_ENDPOINT,
                json={'model': OLLAMA_MODEL, 'prompt': prompt, 'stream': False}
            ) as response:                
                if response.status != 200:
                    logging.error('Ollama returned status %d', response.status)
                    return None
                
                result = await response.json()
                logging.info('Ollama response: %s', result)
    except Exception:
        logging.exception('Error querying Ollama')
        return None
    text_candidates = []
    if 'output' in result:
        output = result['output']
        logging.info('Ollama output field found')
        if isinstance(output, list):
            text_candidates.append(''.join(output))
        elif isinstance(output, str):
            text_candidates.append(output)
    if 'response' in result and isinstance(result['response'], str):
        text_candidates.append(result['response'])
    if 'content' in result and isinstance(result['content'], str):
        text_candidates.append(result['content'])
    if not text_candidates:
        logging.error('No textual field returned by Ollama, keys=%s', list(result.keys()))
        return None
    text = next((t for t in text_candidates if t and t.strip()), '')
    def sanitize_response(raw: str) -> str:
        cleaned = raw.strip()
        if cleaned.startswith('```'):
            cleaned = cleaned.split('\n', 1)[1] if '\n' in cleaned else ''
        if cleaned.endswith('```'):
            cleaned = cleaned.rsplit('```', 1)[0]
        return cleaned.strip()

    text = sanitize_response(text)
    if not text:
        return None

    text = sanitize_response(text)
    if not text:
        return None
    decoder = json.JSONDecoder()
    try:
        decoded, _ = decoder.raw_decode(text)
        return decoded
    except json.JSONDecodeError:
        logging.info('Ollama response is not JSON')
        return None

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

async def ollama_handler(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    command = (data.get('command') or data.get('prompt') or '').strip()
    if not command:
        return web.json_response({'error': 'command is required'}, status=400)
    logging.info('Received command: %s', command)

    payload = await query_ollama_payload(command)
    logging.info('Ollama payload: %s', payload)
    if payload is None:
        return web.json_response({'error': 'failed to generate payload'}, status=502)

    await send_broadcast({
        'type': 'broadcast',
        'origin': 'ollama',
        'timestamp': datetime.utcnow().isoformat(),
        'body': payload
    })

    return web.json_response({'status': 'ok', 'payload': payload})

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
app.router.add_post('/ollama', ollama_handler)
app.router.add_static('/static/', path=PUBLIC_DIR, name='static')
app.on_startup.append(start_background)
app.on_cleanup.append(stop_background)

if __name__ == '__main__':
    web.run_app(app, port=3000)
