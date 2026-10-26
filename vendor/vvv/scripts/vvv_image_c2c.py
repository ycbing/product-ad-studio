"""A single-turn, ChatGPT-authenticated adapter for the pinned c2c executor.

The local probe does not verify a subscription, quota, or image-generation access.
Only Codex reads its authentication store. No daemon, full-config fallback, retries,
or local image conversion are used here.
"""
from functools import lru_cache
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
from types import SimpleNamespace
from typing import Optional


UPSTREAM_VERSION = '0.4.1'
UPSTREAM_COMMIT = 'ff836516ba56610ebdddd6d9ae66a653694e0e71'
UPSTREAM_SHA256 = 'd69becf2df8184e72064b0b1d2053e10fdded350a1e5d873f40b977edd8e1989'
_VENDOR = Path(__file__).resolve().parents[1] / 'vendor' / 'c2c_img'
_REQUIRED_FLAGS = {
    '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json',
    '--skip-git-repo-check', '--sandbox', '--cd', '--enable', '--disable', '--image',
}
_MESSAGES = {
    'auth': 'Sign in to Codex with a ChatGPT account, or configure the separate API route.',
    'quota': 'Codex reported a usage limit. Wait for it to reset or select another configured route.',
    'timeout': 'The Codex image request timed out. No automatic retry was made.',
    'capacity': 'Codex reported that the service is at capacity. No automatic retry was made.',
    'generation_failed': 'Codex could not complete the image request. Review the request before trying again.',
    'model': 'The installed Codex rejected the orchestration model or request configuration.',
    'unknown': 'The Codex image request failed. Run the local image doctor for setup diagnostics.',
    'cli_incompatible': 'The installed Codex does not expose the required c2c execution flags.',
    'unavailable': 'A compatible local Codex image setup is unavailable. Check the image doctor or configure the API route.',
    'bad_request': 'The c2c request or timeout is invalid.',
    'output_invalid': 'Codex did not provide a complete local image file.',
    'output_exists': 'The image destination already exists; choose a new destination.',
    'copy_failed': 'The generated image could not be copied to the destination. The upstream image was retained.',
    'vendor_invalid': 'The bundled c2c executor does not match the reviewed version.',
}


class C2CError(Exception):
    """A stable code and a safe message suitable for the public JSON response."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _error(kind: str) -> C2CError:
    return C2CError('c2c_' + kind, _MESSAGES[kind])


@lru_cache(maxsize=1)
def _load_upstream():
    path = _VENDOR / 'c2c_img.py'
    try:
        if hashlib.sha256(path.read_bytes()).hexdigest() != UPSTREAM_SHA256:
            raise _error('vendor_invalid')
        spec = importlib.util.spec_from_file_location('_vvv_pinned_c2c_img', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except C2CError:
        raise
    except Exception:
        raise _error('vendor_invalid') from None


def _resolve_codex(explicit: Optional[str]) -> Optional[str]:
    candidate = _load_upstream().resolve_codex(explicit)
    if not candidate:
        return None
    candidate = os.path.expanduser(candidate)
    found = shutil.which(candidate)
    if not found:
        return None
    return str(Path(found).resolve())


def _inspect_cli(codex: str, *args):
    return subprocess.run([codex, *args], stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, encoding='utf-8',
                          errors='replace', timeout=15)


def probe(codex_bin: Optional[str] = None) -> dict:
    """Inspect local CLI/auth prerequisites without starting a model turn.

    ``available`` means this adapter's local prerequisites passed. ``capability``
    always stays ``unverified``; no subscription or remote entitlement is inferred.
    Authentication text and other raw subprocess output never leave this function.
    """
    result = {'available': False, 'auth': 'unknown', 'codex_bin': None,
              'version': None, 'capability': 'unverified', 'reason': 'probe_failed'}
    try:
        codex = _resolve_codex(codex_bin)
        if not codex:
            result['reason'] = 'codex_missing'
            return result
        result['codex_bin'] = codex
        version = _inspect_cli(codex, '--version')
        match = re.search(r'\b(\d+\.\d+\.\d+)\b', version.stdout)
        if version.returncode != 0 or not match:
            result['reason'] = 'cli_incompatible'
            return result
        result['version'] = match.group(1)
        login = _inspect_cli(codex, 'login', 'status')
        status = login.stdout + '\n' + login.stderr
        if re.search(r'^\s*Not logged in\b', status, re.I | re.M):
            result.update(auth='none', reason='auth_required')
            return result
        if login.returncode == 0 and re.search(
                r'^\s*Logged in using (?:an? )?API[ -]key\b', status, re.I | re.M):
            result.update(auth='api-key', reason='api_key_auth')
            return result
        if login.returncode != 0 or not re.search(
                r'^\s*Logged in using ChatGPT\b', status, re.I | re.M):
            result['reason'] = 'auth_unknown'
            return result
        result['auth'] = 'chatgpt'
        features = _inspect_cli(codex, 'features', 'list')
        if features.returncode != 0:
            result['reason'] = 'cli_incompatible'
            return result
        image_flag = next((line.split() for line in features.stdout.splitlines()
                           if line.split() and line.split()[0] == 'image_generation'), [])
        if not image_flag or 'removed' in [part.lower() for part in image_flag]:
            result['reason'] = 'feature_unavailable'
            return result
        help_result = _inspect_cli(codex, 'exec', '--help')
        flags = set(re.findall(r'--[a-z][a-z-]*', help_result.stdout))
        if help_result.returncode != 0 or not _REQUIRED_FLAGS.issubset(flags):
            result['reason'] = 'cli_incompatible'
            return result
        result.update(available=True, reason='ready')
        return result
    except Exception:
        # Neither exception messages nor subprocess output are safe public diagnostics.
        result['reason'] = 'probe_failed'
        return result


def generate(config: dict, request: dict, references: list[Path], destination: Path) -> dict:
    """Run the pinned lean executor once and copy its native image unchanged.

    The caller owns request validation, reference decoding, image prompt semantics,
    and verification of output dimensions/format/alpha. Size is deliberately not
    passed to c2c postprocessing, and the upstream image is never moved or deleted.
    """
    try:
        timeout = config.get('timeout', 300)
        if (isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not 1 <= timeout <= 600
                or request.get('operation') not in ('generate', 'edit')
                or not isinstance(request.get('prompt'), str) or not request['prompt'].strip()
                or request.get('background', 'auto') not in ('opaque', 'transparent', 'auto')):
            raise _error('bad_request')
        destination = Path(destination)
        if destination.exists() or destination.is_symlink():
            raise _error('output_exists')
        diagnostic = probe(config.get('codex_bin'))
        if not diagnostic['available']:
            reason = diagnostic['reason']
            if reason in ('auth_required', 'api_key_auth', 'auth_unknown'):
                raise _error('auth')
            raise _error('cli_incompatible' if reason == 'cli_incompatible' else 'unavailable')
        upstream = _load_upstream()
        job = {'index': 0, 'prompt': request['prompt'],
               'refs': [str(Path(path).resolve()) for path in references],
               'transparent': request.get('background') == 'transparent',
               'size': None, 'fmt': request.get('format', 'png'), 'out': str(destination)}
        options = SimpleNamespace(timeout=timeout, keep_session=False, model=None)
        result = upstream.run_exec(job, options, diagnostic['codex_bin'], lean=True)
        if not result.get('src'):
            kind = upstream.classify(result)
            raise _error(kind if kind in _MESSAGES else 'unknown')
        source = Path(result['src'])
        if source.is_symlink() or not source.is_file() or not upstream.image_complete(str(source)):
            raise _error('output_invalid')
    except C2CError:
        raise
    except Exception:
        raise _error('unknown') from None

    created = False
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as target:
            created = True
            with source.open('rb') as original:
                shutil.copyfileobj(original, target)
    except FileExistsError:
        raise _error('output_exists') from None
    except Exception:
        if created:
            try:
                destination.unlink()
            except OSError:
                pass
        raise _error('copy_failed') from None
    return {'provider': 'c2c', 'engine': 'exec-lean', 'model': None,
            'upstream_version': UPSTREAM_VERSION, 'upstream_commit': UPSTREAM_COMMIT,
            'source_format': source.suffix.lower().lstrip('.').replace('jpeg', 'jpg')}
