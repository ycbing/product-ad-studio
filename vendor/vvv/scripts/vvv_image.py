#!/usr/bin/env python3
"""VVV image request, provider selection and verified project-local delivery."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import uuid
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

import vvv_image_api as api
import vvv_image_c2c as c2c

VERSION = '0.1'
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000
FORMATS = {'png': 'PNG', 'webp': 'WEBP', 'jpeg': 'JPEG'}
PROVIDERS = ('auto', 'native', 'c2c', 'api')


class ImageError(Exception):
    def __init__(self, code, message, record=None):
        super().__init__(message)
        self.code, self.message, self.record = code, message, record


def fail(code, message):
    raise ImageError(code, message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    try:
        if path.stat().st_size > 1024 * 1024:
            fail('bad_request', 'JSON input exceeds 1 MiB.')
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict):
            fail('bad_request', 'Expected a JSON object.')
        return value
    except (OSError, UnicodeError, ValueError):
        fail('bad_request', 'Cannot read the JSON input.')


def project_root(project):
    root = Path(project).expanduser().resolve()
    if not root.is_dir():
        fail('invalid_project', 'Use an existing local project directory.')
    manifest = safe_path(root, 'vvv.json')
    if manifest.exists():
        if not manifest.is_file():
            fail('invalid_project', 'The project vvv.json must be a regular file.')
        document = read_json(manifest)
        if document.get('vvvFormat') != '1.0' and document.get('version') != VERSION:
            fail('invalid_project', 'Unsupported VVV project version.')
    for rel in ('public', 'public/generated', 'creative', 'creative/image-jobs', 'creative/image-plans'):
        safe_path(root, rel)
    return root


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative:
        fail('unsafe_path', 'Use a project-relative path with forward slashes.')
    rel = PurePosixPath(relative)
    if rel.is_absolute() or '..' in rel.parts or ':' in relative or '\x00' in relative:
        fail('unsafe_path', 'Paths must remain inside the project.')
    path = root
    for part in rel.parts:
        path = path / part
        if path.is_symlink():
            fail('unsafe_path', 'Symbolic links are not supported for image inputs or outputs.')
    if not path.resolve().is_relative_to(root):
        fail('unsafe_path', 'Path escapes the project.')
    return path


def decoded(path):
    try:
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            fail('invalid_output', 'Image is missing or exceeds 20 MiB.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format not in FORMATS.values() or getattr(image, 'n_frames', 1) != 1:
                    fail('invalid_output', 'Use a single-frame PNG, JPEG or WebP image.')
                if image.width * image.height > MAX_PIXELS:
                    fail('invalid_output', 'Image exceeds the 40 million pixel limit.')
                image.load()
                normalized = ImageOps.exif_transpose(image).convert('RGBA')
                return normalized, image.format
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        fail('invalid_output', 'Image cannot be safely decoded.')


def prepare(project, request):
    root = project_root(project)
    allowed = {'version', 'id', 'operation', 'prompt', 'references', 'background', 'size', 'format', 'resize'}
    if not isinstance(request, dict) or set(request) - allowed:
        fail('bad_request', 'Unknown image request fields.')
    req = dict(request)
    defaults = {'operation': 'generate', 'references': [], 'background': 'auto',
                'size': 'auto', 'format': 'png', 'resize': 'none'}
    for key, value in defaults.items():
        req.setdefault(key, value)
    if req.get('version') != VERSION:
        fail('bad_request', 'Image request version must be 0.1.')
    if not isinstance(req.get('id'), str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', req['id']):
        fail('bad_request', 'id must contain 1–64 lowercase letters, digits, underscores or hyphens.')
    if not isinstance(req.get('prompt'), str) or not req['prompt'].strip() or len(req['prompt']) > 30000:
        fail('bad_request', 'prompt must contain 1–30000 characters.')
    for key, choices in {'operation': ('generate', 'edit'), 'background': ('auto', 'opaque', 'transparent'),
                         'format': tuple(FORMATS), 'resize': ('none', 'contain', 'cover')}.items():
        if req[key] not in choices:
            fail('bad_request', 'Unsupported ' + key + '.')
    if req['background'] == 'transparent' and req['format'] == 'jpeg':
        fail('bad_request', 'Transparent output requires PNG or WebP.')
    size = req['size']
    if not isinstance(size, str) or (size != 'auto' and not re.fullmatch(r'[1-9][0-9]{0,3}x[1-9][0-9]{0,3}', size)):
        fail('bad_request', 'size must be auto or positive WIDTHxHEIGHT.')
    if size != 'auto':
        w, h = map(int, size.split('x'))
        if w * h > MAX_PIXELS or max(w, h) > 8192:
            fail('bad_request', 'Canvas exceeds supported dimensions.')
    elif req['resize'] != 'none':
        fail('bad_request', 'Explicit resize requires explicit dimensions.')
    if not isinstance(req['references'], list) or len(req['references']) > 16:
        fail('bad_request', 'references must be a list of at most 16 images.')
    refs, evidence, targets, transparent_target = [], [], 0, False
    for ref in req['references']:
        if not isinstance(ref, dict) or set(ref) - {'path', 'role', 'note'}:
            fail('bad_request', 'References accept path, role and optional note.')
        if ref.get('role') not in ('edit-target', 'style', 'content'):
            fail('bad_request', 'Reference role must be edit-target, style or content.')
        if not isinstance(ref.get('note', ''), str) or len(ref.get('note', '')) > 1000:
            fail('bad_request', 'Reference note must be text up to 1000 characters.')
        path = safe_path(root, ref.get('path'))
        image, fmt = decoded(path)
        refs.append(path)
        evidence.append(dict(ref, sha256=digest(path), width=image.width, height=image.height, format=fmt))
        targets += ref['role'] == 'edit-target'
        if ref['role'] == 'edit-target' and image.getchannel('A').getextrema()[0] < 255:
            transparent_target = True
    if req['operation'] == 'edit' and not targets:
        fail('bad_request', 'An edit requires at least one edit-target reference.')
    if req['operation'] == 'generate' and targets:
        fail('bad_request', 'An edit-target reference requires operation=edit.')
    if req['background'] == 'auto' and req['operation'] == 'edit' and transparent_target:
        req['background'] = 'transparent'
        if req['format'] == 'jpeg':
            fail('bad_request', 'Preserving reference transparency requires PNG or WebP.')
    if len(effective_prompt(req)) > 32000:
        fail('bad_request', 'Prompt and reference notes together exceed 32000 characters.')
    return root, req, refs, evidence


def config_for(root):
    path = safe_path(root, 'vvv.image.json')
    if not path.exists():
        return {'version': VERSION, 'provider': 'auto'}
    config = read_json(path)
    if set(config) - {'version', 'provider', 'c2c', 'api'} or config.get('version') != VERSION:
        fail('configuration_required', 'Use the documented vvv.image.json version 0.1 configuration.')
    if config.get('provider', 'auto') not in PROVIDERS:
        fail('configuration_required', 'Unknown configured image provider.')
    for key in ('c2c', 'api'):
        if key in config and not isinstance(config[key], dict):
            fail('configuration_required', key + ' configuration must be an object.')
    for key, fields in {'c2c': {'codex_bin', 'timeout'},
                        'api': {'base_url', 'model', 'key_env', 'capabilities', 'timeout'}}.items():
        if set(config.get(key, {})) - fields:
            fail('configuration_required', 'Unknown ' + key + ' configuration fields; store credentials only in the named environment variable.')
    return config


def select_provider(config, provider='auto', native_available=False):
    chosen = config.get('provider', 'auto') if provider == 'auto' else provider
    if chosen == 'auto' and native_available:
        return 'native'
    if chosen == 'native':
        if not native_available:
            fail('native_unavailable', 'This session must expose an actual native image tool. Use c2c or configure an API.')
        return 'native'
    if chosen in ('auto', 'c2c'):
        status = c2c.probe(config.get('c2c', {}).get('codex_bin'))
        if status.get('available'):
            return 'c2c'
        fail('configuration_required', 'Local Codex bridge is not ready (' + status.get('reason', 'unknown') +
             '). Sign in to Codex with a supported ChatGPT account, or configure and select an image API. Login alone does not prove image access.')
    if chosen == 'api':
        return 'api'
    fail('bad_request', 'Unknown image provider.')


def effective_prompt(req):
    specs = ['VVV production requirements:', 'Operation: ' + req['operation'] + '.',
             'Background: ' + req['background'] + '.']
    if req['size'] != 'auto':
        specs.append('Requested canvas: ' + req['size'] + ' pixels. Compose for this aspect ratio.')
    for index, ref in enumerate(req['references'], 1):
        specs.append('Reference ' + str(index) + ': ' + ref['role'] + '. ' + ref.get('note', ''))
    return req['prompt'] + '\n\n' + '\n'.join(specs)


def check_background(image, req):
    alpha = image.getchannel('A').getextrema()
    if alpha[1] == 0:
        fail('empty_output', 'The image is fully transparent and contains no visible content.')
    if req['background'] == 'transparent' and alpha[0] == 255:
        fail('background_mismatch', 'Requested transparent background, but the output has no transparent pixels.')
    if req['background'] == 'opaque' and alpha[0] < 255:
        fail('background_mismatch', 'Requested an opaque background, but the output contains transparency.')


def plan(project, request, provider='auto', native_available=False):
    root, req, refs, evidence = prepare(project, request)
    chosen = select_provider(config_for(root), provider, native_available)
    result = {'ok': True, 'status': 'planned', 'provider': chosen, 'request': req,
              'effective_prompt': effective_prompt(req), 'references': evidence,
              'capability': 'unverified-until-generation'}
    if chosen == 'native':
        args = {'prompt': result['effective_prompt'], 'transparent_background': req['background'] == 'transparent'}
        if refs:
            args['referenced_image_paths'] = [str(p) for p in refs]
        receipt = {'version': VERSION, 'provider': 'native', 'request': req, 'references': evidence,
                   'effectivePrompt': result['effective_prompt']}
        folder = safe_path(root, 'creative/image-plans')
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (req['id'] + '-' + uuid.uuid4().hex + '.json')
        with path.open('x', encoding='utf-8') as output:
            output.write(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        result.update(status='native_tool_required', tool_arguments=args, plan=path.relative_to(root).as_posix(),
                      next='Call the actual native image tool, then adopt its local output file with this request.')
    return result


def doctor(project, native_available=False):
    root = project_root(project)
    config = config_for(root)
    api_config = config.get('api', {})
    key_env = api_config.get('key_env')
    return {'ok': True, 'status': 'diagnosed', 'configured_provider': config.get('provider', 'auto'),
            'native': {'available': native_available, 'evidence': 'calling-agent-declaration'},
            'c2c': c2c.probe(config.get('c2c', {}).get('codex_bin')),
            'api': {'configured': bool(api_config), 'key_present': bool(isinstance(key_env, str) and os.getenv(key_env)),
                    'capability': 'unverified', 'network_checked': False},
            'note': 'No image generated. CLI login does not verify subscription, quota or image capability.'}


def save_record(root, folder, record):
    path = folder / 'job.json'
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path.relative_to(root).as_posix()


def deliver(root, req, refs, evidence, provider, producer):
    # A unique directory keeps concurrent runs independent. No shared registry is rewritten.
    job_id = req['id'] + '-' + uuid.uuid4().hex
    jobs = safe_path(root, 'creative/image-jobs')
    jobs.mkdir(parents=True, exist_ok=True)
    folder = jobs / job_id
    folder.mkdir()
    raw = folder / 'raw'
    record = {'version': VERSION, 'id': job_id, 'createdAt': datetime.now(timezone.utc).isoformat(),
              'status': 'running', 'request': req, 'effectivePrompt': effective_prompt(req),
              'references': evidence, 'provider': {'provider': provider},
              'visualReview': 'not-reviewed', 'processing': []}
    record_path = save_record(root, folder, record)
    output_dir = None
    try:
        augmented = dict(req, prompt=record['effectivePrompt'])
        record['provider'] = producer(augmented, refs, raw)
        if raw.exists():
            record['raw'] = {'file': raw.relative_to(root).as_posix(), 'sha256': digest(raw)}
        image, source_format = decoded(raw)
        record['raw'].update(format=source_format, width=image.width, height=image.height)
        # A provider cannot quietly claim to have used a changed reference image.
        if any(digest(path) != item['sha256'] for path, item in zip(refs, evidence)):
            fail('inputs_changed', 'A reference changed during generation. Review the raw output before using it.')
        check_background(image, req)
        record['processing'].append('normalize-exif-and-encode-' + req['format'])
        if req['size'] != 'auto':
            size = tuple(map(int, req['size'].split('x')))
            if image.size != size:
                if req['resize'] == 'none':
                    fail('dimensions_mismatch', 'Generated dimensions differ from the requested canvas; raw output was preserved. Do not automatically retry generation or edit the original plan receipt. Follow the provider-specific size-mismatch recovery steps in references/image-generation.md.')
                if req['resize'] == 'cover':
                    image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
                else:
                    tile = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
                    canvas = Image.new('RGBA', size, (0, 0, 0, 0) if req['background'] == 'transparent' else (255, 255, 255, 255))
                    canvas.paste(tile, ((size[0] - tile.width) // 2, (size[1] - tile.height) // 2))
                    image = canvas
                record['processing'].append('resize-' + req['resize'])
        if req['format'] == 'jpeg':
            if image.getchannel('A').getextrema()[0] < 255:
                fail('background_mismatch', 'JPEG would discard transparency. Request PNG/WebP or an opaque image.')
            image = image.convert('RGB')
        output_dir = safe_path(root, 'public/generated/' + job_id)
        output_dir.mkdir(parents=True)
        output = output_dir / ('image.' + ('jpg' if req['format'] == 'jpeg' else req['format']))
        options = {'quality': 95} if req['format'] == 'jpeg' else {'lossless': True} if req['format'] == 'webp' else {}
        image.save(output, format=FORMATS[req['format']], **options)
        checked, fmt = decoded(output)
        check_background(checked, req)
        asset = {'id': job_id, 'file': output.relative_to(root / 'public').as_posix(),
                 'width': checked.width, 'height': checked.height, 'format': fmt.lower(),
                 'orientation': 'landscape' if checked.width > checked.height else 'portrait' if checked.width < checked.height else 'square',
                 'has_transparency': checked.getchannel('A').getextrema()[0] < 255,
                 'sha256': digest(output), 'source': {'kind': 'generated-image', 'record': record_path}}
        record.update(status='generated', asset=asset)
        save_record(root, folder, record)
        return {'ok': True, 'status': 'generated', 'provider': provider, 'asset': asset, 'record': record_path,
                'next': 'Inspect the image, connect it to the intended scene, and render the affected sample.'}
    except (ImageError, api.ImageAPIError, c2c.C2CError, OSError, ValueError) as exc:
        if output_dir is not None and output_dir.is_dir():
            shutil.rmtree(output_dir)
        code = getattr(exc, 'code', 'local_io_error')
        message = getattr(exc, 'message', 'Local image processing failed. Raw output, if received, was preserved.')
        if raw.is_file() and 'raw' not in record:
            record['raw'] = {'file': raw.relative_to(root).as_posix()}
        record.update(status='failed', error={'code': code, 'message': message})
        save_record(root, folder, record)
        raise ImageError(code, message, record_path) from None


def generate(project, request, provider='auto', native_available=False):
    root, req, refs, evidence = prepare(project, request)
    config = config_for(root)
    chosen = select_provider(config, provider, native_available)
    if chosen == 'native':
        return plan(root, req, chosen, native_available=True)
    adapter = c2c if chosen == 'c2c' else api
    return deliver(root, req, refs, evidence, chosen,
                   lambda augmented, refs, raw: adapter.generate(config.get(chosen, {}), augmented, refs, raw))


def adopt(project, request, source, plan_path=None):
    root, req, refs, evidence = prepare(project, request)
    if not plan_path:
        fail('plan_required', 'Native adoption requires the original plan returned before generation.')
    receipt = read_json(safe_path(root, plan_path))
    expected = {'version': VERSION, 'provider': 'native', 'request': req, 'references': evidence,
                'effectivePrompt': effective_prompt(req)}
    if receipt != expected:
        fail('inputs_changed', 'The request or reference images changed after planning. Use the original inputs or make a new generation plan.')
    source = Path(source).expanduser()
    if source.is_symlink():
        fail('unsafe_path', 'Adopt an actual local image file, not a symbolic link.')
    decoded(source)
    def producer(augmented, refs, raw):
        shutil.copyfile(source, raw)
        return {'provider': 'native', 'evidence': 'agent-supplied-native-output', 'plan': plan_path, 'model': None}
    return deliver(root, req, refs, evidence, 'native', producer)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('doctor', 'plan', 'generate', 'adopt'):
        command = commands.add_parser(name)
        command.add_argument('--project', required=True)
        if name != 'doctor':
            command.add_argument('--request', required=True, help='Path to image request JSON')
        if name in ('plan', 'generate'):
            command.add_argument('--provider', choices=PROVIDERS, default='auto')
        if name != 'adopt':
            command.add_argument('--native-available', action='store_true', help='Only if this session actually exposes an image tool')
        if name == 'adopt':
            command.add_argument('--source', required=True, help='Actual native image tool output')
            command.add_argument('--plan', required=True, help='Project-relative receipt returned by plan before generation')
    args = parser.parse_args(argv)
    try:
        if args.command == 'doctor':
            result = doctor(args.project, args.native_available)
        else:
            request = read_json(Path(args.request).expanduser())
            if args.command == 'adopt':
                result = adopt(args.project, request, args.source, args.plan)
            else:
                result = globals()[args.command](args.project, request, args.provider, args.native_available)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ImageError, OSError, ValueError) as exc:
        result = {'ok': False, 'status': 'failed', 'error': {'code': getattr(exc, 'code', 'local_error'),
                   'message': getattr(exc, 'message', 'The local image workflow could not complete. Check the request and filesystem.')}}
        if getattr(exc, 'record', None):
            result['record'] = exc.record
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    sys.exit(main())
