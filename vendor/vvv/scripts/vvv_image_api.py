"""A bounded, single-request adapter for the GPT Image-style Images API.

Compatibility requires JSON /images/generations and multipart /images/edits
with image[], model, prompt, n, output_format, optional background and size,
and a non-streaming data[0].b64_json response. This is not a universal adapter
for every service advertising OpenAI compatibility. In particular it does not
send the legacy response_format parameter, download URL-only results, retry,
follow redirects, or select a model/provider on the caller's behalf.

Limits are local resource protections, not promises about provider support:
32,000 prompt characters, 16 references, 20 MiB per reference/output image,
64 MiB request body and 32 MiB response body. The caller validates image
contents, dimensions and requested transparency after receiving the file.
"""

import base64
import binascii
from http.client import HTTPException
import io
import json
import os
from pathlib import Path
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid

from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


class ImageAPIError(Exception):
    """A stable error code and safe message suitable for the CLI's JSON report."""

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Even a same-origin POST redirect can create a second billable request.
        return None


def _configuration(config):
    if not isinstance(config, dict):
        raise ImageAPIError('configuration_required', 'Configure the Images API provider first.')
    base_url = config.get('base_url')
    model = config.get('model')
    key_env = config.get('key_env')
    capabilities = config.get('capabilities')
    timeout = config.get('timeout', 180)
    if (not isinstance(model, str) or not model.strip() or len(model) > 256
            or any(ord(char) < 32 or ord(char) == 127 for char in model)
            or not isinstance(key_env, str)
            or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,255}', key_env)
            or not isinstance(capabilities, dict)
            or any(type(capabilities.get(name)) is not bool for name in ('edit', 'transparent'))
            or type(timeout) not in (int, float)
            or not 1 <= timeout <= 600):
        raise ImageAPIError('configuration_required', 'Images API model, key environment variable, capabilities or timeout is invalid.')
    if (not isinstance(base_url, str) or not base_url
            or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in base_url)
            or any(char in base_url for char in ('?', '#', '\\'))):
        raise ImageAPIError('configuration_required', 'Images API base URL must be a clean HTTPS URL without credentials, query or fragment.')
    try:
        parsed = urlsplit(base_url)
        valid_port = parsed.port is None or 1 <= parsed.port <= 65535
        local_http = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')
        valid = (bool(parsed.hostname) and valid_port and parsed.username is None
                 and parsed.password is None and (parsed.scheme == 'https' or local_http))
        base_url.encode('ascii')
    except (ValueError, UnicodeError):
        valid = False
    if not valid:
        raise ImageAPIError('configuration_required', 'Images API requires HTTPS; HTTP is permitted only for a loopback test server.')
    # Do not consult credential files, .env files, platform sessions or other keys.
    key = os.environ.get(key_env, '')
    if (not key or len(key) > 8192
            or any(ord(char) < 33 or ord(char) > 126 for char in key)):
        raise ImageAPIError('configuration_required', 'Set a valid API key in the configured environment variable.')
    return base_url.rstrip('/'), model, key, capabilities, timeout


def _payload(request, model, capabilities, references):
    operation = request.get('operation')
    background = request.get('background')
    output_format = request.get('format')
    size = request.get('size')
    prompt = request.get('prompt')
    if (operation not in ('generate', 'edit') or background not in ('opaque', 'transparent', 'auto')
            or output_format not in ('png', 'webp', 'jpeg')
            or not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 32000
            or not isinstance(size, str)
            or (size != 'auto' and not re.fullmatch(r'[1-9][0-9]*x[1-9][0-9]*', size))):
        raise ImageAPIError('unsupported_capability', 'The requested image parameters are not supported by this adapter.')
    if len(references) > 16:
        raise ImageAPIError('unsupported_capability', 'The Images API adapter accepts at most 16 reference images.')
    if operation == 'edit' and not references:
        raise ImageAPIError('unsupported_capability', 'Image editing requires at least one reference image.')
    if references and not capabilities['edit']:
        raise ImageAPIError('unsupported_capability', 'The configured provider does not support editing or reference images.')
    if background == 'transparent' and (not capabilities['transparent'] or output_format == 'jpeg'):
        raise ImageAPIError('unsupported_capability', 'Transparent output requires provider support and PNG or WebP format.')
    payload = {'model': model, 'prompt': prompt, 'n': 1, 'output_format': output_format}
    if background != 'auto':
        payload['background'] = background
    if size != 'auto':
        payload['size'] = size
    return payload


def _multipart(payload, references):
    boundary = 'vvv-' + uuid.uuid4().hex
    body = bytearray()

    def append(part):
        if len(body) + len(part) > MAX_REQUEST_BYTES:
            raise ImageAPIError('unsupported_capability', 'The image request exceeds the local request size limit.')
        body.extend(part)

    for name, value in payload.items():
        append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                % (boundary, name, value)).encode('utf-8'))
    types = {'PNG': ('image/png', 'png'), 'JPEG': ('image/jpeg', 'jpg'),
             'WEBP': ('image/webp', 'webp')}
    for index, reference in enumerate(references):
        try:
            with Path(reference).open('rb') as source:
                content = source.read(MAX_IMAGE_BYTES + 1)
            if len(content) > MAX_IMAGE_BYTES:
                raise ImageAPIError('unsupported_capability', 'A reference image exceeds the local image size limit.')
            with Image.open(io.BytesIO(content)) as image:
                media = types.get(image.format)
            if media is None:
                raise ImageAPIError('unsupported_capability', 'API reference images must contain PNG, JPEG or WebP data.')
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            raise ImageAPIError('unsupported_capability', 'A reference image could not be read as supported image data.') from None
        mime, extension = media
        # Synthetic filenames avoid leaking local paths and prevent header injection.
        append(('--%s\r\nContent-Disposition: form-data; name="image[]"; '
                'filename="reference-%s.%s"\r\nContent-Type: %s\r\n\r\n'
                % (boundary, index + 1, extension, mime)).encode('ascii'))
        append(content)
        append(b'\r\n')
    append(('--%s--\r\n' % boundary).encode('ascii'))
    return bytes(body), 'multipart/form-data; boundary=' + boundary


def _decode_response(body):
    try:
        response = json.loads(body)
        data = response.get('data') if isinstance(response, dict) else None
        encoded = data[0].get('b64_json') if isinstance(data, list) and data and isinstance(data[0], dict) else None
        if not isinstance(encoded, str) or not encoded:
            raise ValueError
        if len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
            raise ValueError
        content = base64.b64decode(encoded, validate=True)
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError
    except (ValueError, TypeError, UnicodeError, binascii.Error, RecursionError):
        raise ImageAPIError('invalid_output', 'The provider must return one bounded base64 image in data[0].b64_json; URL-only output is unsupported.') from None
    return content


def generate(config: dict, request: dict, references: list[Path], destination: Path) -> dict:
    """Send one explicit API request and save decoded bytes to a new destination.

    ``config`` is the project's ``api`` object. Only ``key_env`` supplies the
    credential. A generate request with references uses the edit endpoint.
    The caller must validate the saved image before making it a project asset.
    HTTP loopback endpoints are allowed solely for offline fixture testing.
    ``timeout`` is the urllib socket timeout (1..600 seconds, default 180).
    """
    base_url, model, key, capabilities, timeout = _configuration(config)
    destination = Path(destination)
    if destination.exists() or destination.is_symlink() or not destination.parent.is_dir():
        raise ImageAPIError('invalid_output', 'The image destination must be a new file in an existing directory.')
    payload = _payload(request, model, capabilities, references)
    if references:
        endpoint = '/images/edits'
        body, content_type = _multipart(payload, references)
    else:
        endpoint = '/images/generations'
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        content_type = 'application/json'
    if len(body) > MAX_REQUEST_BYTES:
        raise ImageAPIError('unsupported_capability', 'The image request exceeds the local request size limit.')
    outgoing = Request(base_url + endpoint, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + key, 'Content-Type': content_type,
        'Accept': 'application/json', 'User-Agent': 'vvv-images-api/0.1'})
    try:
        # No retry policy, implicit provider selection or POST redirect handling.
        with build_opener(_NoRedirects()).open(outgoing, timeout=timeout) as response:
            if not 200 <= response.status < 300:
                raise ImageAPIError('api_error', 'The image provider did not accept the request.')
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ImageAPIError('invalid_output', 'The image provider response exceeds the local response size limit.')
    except HTTPError as error:
        status = error.code
        error.close()
        if status in (401, 403):
            code, message = 'api_auth', 'The image provider rejected authentication or access.'
        elif status == 429:
            code, message = 'api_quota', 'The image provider reported a quota or rate limit.'
        elif status in (408, 504):
            code, message = 'api_timeout', 'The image provider request timed out; it was not retried.'
        else:
            code, message = 'api_error', 'The image provider request failed; redirects and retries are disabled.'
        raise ImageAPIError(code, message) from None
    except (TimeoutError, socket.timeout):
        raise ImageAPIError('api_timeout', 'The image provider request timed out; it was not retried.') from None
    except URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise ImageAPIError('api_timeout', 'The image provider request timed out; it was not retried.') from None
        raise ImageAPIError('api_error', 'The image provider could not be reached; the request was not retried.') from None
    except (OSError, HTTPException, ValueError):
        raise ImageAPIError('api_error', 'The image provider request could not be completed; it was not retried.') from None
    content = _decode_response(raw)
    try:
        with destination.open('xb') as output:
            output.write(content)
    except OSError:
        raise ImageAPIError('invalid_output', 'The returned image could not be saved to the new destination.') from None
    return {'provider': 'api', 'model': model, 'transport': 'images-api', 'base_url': base_url}
