"""The .vvv package: a VVV project directory in one ZIP file.

A package is a complete, runnable Remotion project (unzip, npm ci, npm run music, render) plus a manifest that
agents can read without running anything. Three kinds share one layout: a reusable `template` with fictional demo
inputs, a finished `project` handed to someone else to continue, and an `effect` that can be added to a project.
Reading and verifying a package never executes its code.
"""
from __future__ import annotations

from datetime import datetime, timezone
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import zipfile
import zlib

import vvv_schema

FORMAT = '1.0'
MIMETYPE = 'application/vnd.vvv+zip'
KINDS = ('template', 'project', 'effect')
NAME = re.compile(r'@[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*')
SEMVER = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?')
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
LIMITS = {'entries': 20000, 'bytes': 4 * 1024 ** 3, 'file': 2 * 1024 ** 3, 'ratio': 400}
# Package-level files: describe the package and are not part of the project fingerprint.
PACKAGE_ONLY = ('mimetype', 'integrity.json', 'licenses.json', 'AGENTS.md', 'CLAUDE.md', 'README.md')
PACKAGE_DIRS = ('schema/', 'preview/', 'check/')
# Never packaged: dependencies, caches and render output (reports are kept for projects).
EXCLUDE = ('node_modules/', 'build/', 'out/', '.remotion/', '.git/', '__pycache__/')
EXCLUDE_NAMES = ('.DS_Store', '.env')
KIT_SUPPORT = ['package.json', 'package-lock.json', 'tsconfig.json', 'remotion.config.ts', 'LICENSE',
               'MEDIA_LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'package-licenses.json',
               'scripts/render.mjs', 'scripts/render-support.mjs', 'scripts/fetch-music.mjs',
               'scripts/analyze-music.mjs', 'scripts/prepare-fonts.mjs', 'scripts/calibrate.py',
               'scripts/export-schemas.cjs']


class PackageError(ValueError):
    pass


def fail(code, message):
    raise PackageError(f'{code}: {message}')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def dump(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


# ------------------------------------------------------------------------------------- manifest schema


MANIFEST_SCHEMA = Path(__file__).resolve().parents[1] / 'schema' / 'vvv-1.0.schema.json'


def validate_manifest_schema(manifest):
    """Return human-readable schema errors for a manifest, without executing it."""
    try:
        schema = read_json(MANIFEST_SCHEMA)
    except (OSError, ValueError, UnicodeDecodeError) as error:
        return [f'cannot load manifest schema: {error}']
    return vvv_schema.errors(manifest, schema)


# --------------------------------------------------------------------------------------------- paths


def safe_member(name):
    """A POSIX relative path inside the package, or a PackageError."""
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name:
        fail('UNSAFE_PATH', repr(name))
    if unicodedata.normalize('NFC', name) != name:
        fail('UNSAFE_PATH', f'{name} is not NFC-normalized')
    path = PurePosixPath(name)
    if path.is_absolute() or re.match(r'^[A-Za-z]:', name) or any(p in ('', '.', '..') for p in name.rstrip('/').split('/')):
        fail('UNSAFE_PATH', name)
    return name


def excluded(relative):
    parts = relative.split('/')
    if parts[-1] in EXCLUDE_NAMES or parts[-1].startswith('.env.'):
        return True
    return any(relative.startswith(prefix) or ('/' + prefix) in ('/' + relative) for prefix in EXCLUDE)


def glob_match(path, pattern):
    if '**' not in pattern:
        return fnmatch.fnmatchcase(path, pattern) and path.count('/') == pattern.count('/')
    regex = re.escape(pattern).replace(r'\*\*', '.*').replace(r'\*', '[^/]*').replace(r'\?', '[^/]')
    return re.fullmatch(regex, path) is not None


def license_for(path, rules, kind):
    for rule in rules:
        if rule.get('kinds') and kind not in rule['kinds']:
            continue
        if any(glob_match(path, pattern) for pattern in rule['match']):
            return rule
    return None


# ----------------------------------------------------------------------------------------- writing


def write_archive(files, output):
    """files: {path: bytes}. mimetype first and stored; then vvv.json; then sorted. Same input, same bytes."""
    output = Path(output).expanduser().absolute()
    if output.exists() or output.is_symlink():
        fail('DESTINATION_EXISTS', output.name)
    if output.suffix != '.vvv':
        fail('PACKAGE_NAME', 'A package file name ends in .vvv.')
    output.parent.mkdir(parents=True, exist_ok=True)
    order = ['mimetype', 'vvv.json'] + sorted(p for p in files if p not in ('mimetype', 'vvv.json'))
    temporary = output.with_name(f'.{output.name}.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w') as archive:
            for name in order:
                info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.create_system = 3
                info.compress_type = zipfile.ZIP_STORED if name == 'mimetype' else zipfile.ZIP_DEFLATED
                archive.writestr(info, files[name], compresslevel=None if name == 'mimetype' else 9)
        temporary.rename(output)
    finally:
        if temporary.exists():
            temporary.unlink()
    data = output.read_bytes()
    return {'path': str(output), 'bytes': len(data), 'sha256': sha256(data), 'files': len(files)}


def finish(files, manifest, rules, kind):
    """Add the package-level records (licenses, integrity, agent notes) to a {path: bytes} project."""
    files['vvv.json'] = dump(manifest)
    files['mimetype'] = MIMETYPE.encode('ascii')
    mapping, problems = {}, []
    for path in sorted(files):
        if path in ('mimetype', 'integrity.json', 'licenses.json'):
            continue
        rule = license_for(path, rules, kind)
        if rule is None:
            problems.append(f'{path}: no license rule')
        elif rule.get('redistribute') is False:
            problems.append(f'{path}: {rule["id"]} forbids redistribution')
        elif rule.get('redistribute') != True and kind != 'project':
            problems.append(f'{path}: {rule["id"]} is owner material; only project packages may carry it')
        else:
            mapping[path] = rule['id']
    if problems:
        fail('PACK_LICENSE', '; '.join(problems[:12]) + (' …' if len(problems) > 12 else ''))
    used = sorted(set(mapping.values()))
    files['licenses.json'] = dump({'vvvFormat': FORMAT, 'rules': [r for r in rules if r['id'] in used],
                                   'files': mapping})
    integrity = {p: {'bytes': len(b), 'sha256': sha256(b)} for p, b in sorted(files.items())
                 if p not in ('mimetype', 'integrity.json')}
    files['integrity.json'] = dump({'vvvFormat': FORMAT, 'algorithm': 'sha256', 'files': integrity})
    return files


def collect_dir(root, prefix=''):
    out = {}
    root = Path(root)
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if excluded(relative + ('/' if path.is_dir() else '')):
            continue
        if path.is_symlink():
            fail('PACK_SYMLINK', relative)
        if path.is_file():
            out[prefix + relative] = path.read_bytes()
    return out


# --------------------------------------------------------------------------------- template packing


def package_info(kit, template, fixture):
    node = shutil.which('node')
    if not node:
        fail('PACK_NEEDS_NODE', 'Packing a template reads its code with Node.js; install Node and the kit dependencies.')
    script = kit / 'scripts' / 'package-info.cjs'
    if not script.is_file():
        fail('PACK_KIT', 'The kit has no scripts/package-info.cjs.')
    result = subprocess.run([node, str(script), template] + ([str(fixture)] if fixture else []), cwd=kit,
                            capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        fail('PACK_INFO', (result.stderr or result.stdout).strip().splitlines()[-1] if (result.stderr or result.stdout) else 'failed')
    return json.loads(result.stdout)


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)


def referenced_ids(props, known):
    found = set()
    for text in strings(props):
        if text in known:
            found.add(text)
        for token in re.split(r'[\s,，|]+', text):
            token = token.lstrip('@')
            if token in known:
                found.add(token)
    return found


AGENTS_BEGIN = '<!-- vvv:generated:begin'
AGENTS_END = '<!-- vvv:generated:end -->'


def project_agents(existing, generated):
    """A project's AGENTS.md: the generated notes inside a marked block, the project's own instructions
    (production constraints, decisions, to-dos) kept byte-for-byte around it."""
    block = (f'{AGENTS_BEGIN}: vvv.py rewrites this block; keep project instructions outside it -->\n'.encode('utf-8') +
             generated.rstrip(b'\n') + f'\n{AGENTS_END}\n'.encode('utf-8'))
    if not existing:
        return block
    text = existing.decode('utf-8')
    start, end = text.find(AGENTS_BEGIN), text.find(AGENTS_END)
    if start != -1 and end > start:
        return text[:start].encode('utf-8') + block + text[end + len(AGENTS_END):].lstrip('\n').encode('utf-8')
    # Written before the block existed: keep all of it after the generated notes.
    return block + b'\n## Project instructions\n\n' + existing


def agents_text(manifest, readme_path, packaged=False):
    """Agent notes for a project directory, or for a package (`packaged`: it carries licenses.json and
    lists its download-only music in vvv.json "downloads")."""
    kind = manifest['kind']
    title = manifest.get('title') or manifest.get('name') or manifest.get('id') or f'VVV {kind}'
    music = ('vvv.json "downloads" and public/music/sources.json' if packaged else 'public/music/sources.json')
    lines = [f'# {title}', '',
             f'This directory is a **VVV {kind}** ({manifest.get("name", manifest.get("id", ""))} {manifest.get("version", "")}): '
             'an editable Remotion video project that can travel as a `.vvv` file. Read this file before changing anything. '
             'The format is described at https://github.com/actionow-ai/vvv/blob/main/docs/format/vvv-1.0.md.', '',
             '## Run it', '', '```sh', 'npm ci', f'npm run music     # fetch download-only music listed in {music}',
             'npm run studio    # preview and edit interactively', 'npm run sample    # render the representative range',
             'npm run render    # render the full film', '```', '',
             'Rendering needs Node.js and Chrome Headless Shell (downloaded on first render). Remotion has its own license '
             '(https://www.remotion.dev/license); companies above its size limit need a Remotion company license.', '',
             '## Change it', '']
    if kind == 'template':
        lines += ['- `inputs.json` holds the demo inputs: fictional photos and copy. To make a real video, initialize a project '
                  'from this package (`vvv.py init --template this.vvv --photos …`) or replace the demo photos and every line of copy.',
                  '- The props schema is `schema/props.schema.json`; slots are listed in `vvv.json` under `template.slots`.']
    elif kind == 'project':
        lines += ['- `inputs.json` holds this film\'s actual inputs; `schema/props.schema.json` describes them and '
                  '`vvv.py validate --project .` checks them before a render.',
                  '- `creative/` keeps the brief, decisions and review notes, and `vvv.json` lists approved constraints under '
                  '`workflow.approvedConstraints`. Read them and keep settled decisions.',
                  '- Photos and media belong to the project owner. Do not reuse them outside this project.']
        if manifest.get('strippedMedia'):
            lines += ['- **Media were left out of this package.** The files listed in `vvv.json` under `strippedMedia` must be '
                      'supplied before rendering.']
    else:
        lines += ['- The effect lives in `src/effects/` and the demo composition shows it. Add it to a project with '
                  '`vvv.py add --project PROJECT --effect this.vvv`, then import it in scene code.']
    lines += ['- Timing, layout and motion live in `src/templates/`. Scenes are planned in beats of the music; keep entrances '
              'on beats (ease-out from the beat) and exits into beats (ease-in to the beat).',
              '- Use only the local fonts in `font-sources.json`, and music the owner has the right to use.', '',
              '## Check it', '',
              '- `vvv.py` is `scripts/vvv.py` in the installed VVV skill (vvv). `python3 <skill>/scripts/vvv.py check --project .` '
              'measures format, audio, still stretches and beat sync. '
              'A passing check is the floor; then look at frames and play the transitions.',
              *(['- `check/` holds the measurements this package was published with; `vvv.py verify` says whether they still '
                 'match the files.'] if kind != 'project' else []), '',
              '## Rights', '',
              ('- `licenses.json` names the terms of every file. Download-only music is never packaged; `npm run music` fetches it '
               'and verifies its SHA-256.' if packaged else
               '- `MEDIA_LICENSE.md` and `public/music/sources.json` name the terms of the media and music. Download-only music '
               'is not redistributed; `npm run music` fetches it and verifies its SHA-256.'), '']
    if readme_path:
        lines += ['## Template notes', '', f'See [{readme_path}]({readme_path}).', '']
    return '\n'.join(lines).encode('utf-8')


def pack_template(kit, template, output, preview=None, poster=None, evidence=(), kind='template'):
    from vvv_project import load_catalog
    kit = Path(kit).expanduser().resolve()
    catalog = load_catalog(kit, template)
    if catalog.get('kind', 'template') != kind:
        fail('PACK_KIND', f"{template} is a {catalog.get('kind', 'template')}; use --{catalog.get('kind', 'template')}.")
    meta = catalog.get('package') or fail('PACK_CATALOG', f'catalog/{template}.json has no "package" block.')
    name, version = meta.get('name'), catalog.get('version')
    if not isinstance(name, str) or not NAME.fullmatch(name):
        fail('PACK_CATALOG', 'package.name must look like @scope/name.')
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        fail('PACK_CATALOG', 'version must be a semantic version such as 1.0.0.')
    fixture_rel = meta.get('fixture')
    fixture = kit / fixture_rel if fixture_rel else None
    if fixture and not fixture.is_file():
        fail('PACK_CATALOG', f'fixture {fixture_rel} does not exist.')
    props = read_json(fixture)['props'] if fixture else dict(catalog['defaultProps'])
    info = package_info(kit, template, fixture)
    rules = read_json(kit / 'package-licenses.json')['rules']
    files = {}

    def add(relative, data=None):
        source = kit / relative
        if data is None:
            if source.is_symlink() or not source.is_file():
                fail('PACK_MISSING', relative)
            data = source.read_bytes()
        files[safe_member(relative)] = data

    for relative in info['code']:
        if relative in ('font-sources.json', 'src/templates/registry.ts', 'assets.json', 'inputs.json'):
            continue
        add(relative)
    add('src/templates/registry.ts', info['registry'].encode('utf-8'))
    for relative in KIT_SUPPORT:
        if (kit / relative).is_file():
            add(relative)
    from vvv_project import runtime_scripts
    package = runtime_scripts(read_json(kit / 'package.json'))
    package['description'] = f'{catalog.get("title", template)} — VVV {kind} package'
    files['package.json'] = (json.dumps(package, ensure_ascii=False, indent=2) + '\n').encode('utf-8')

    # Fonts: only the families the template's code and inputs name.
    fonts = read_json(kit / 'font-sources.json')
    modules = set(info['fontModules'])
    families = [f for f in fonts['families'] if f['module'] in modules]
    names = {f['family'] for f in families}
    fonts = {**fonts, 'families': families, 'faces': [f for f in fonts['faces'] if f['module'] in modules],
             'licenses': [l for l in fonts['licenses'] if l['family'] in names]}
    files['font-sources.json'] = dump(fonts)
    for item in fonts['faces'] + fonts['licenses']:
        add('public/' + item['file'])

    # Public assets named by the code, without download-only media.
    public = kit / 'public'
    sources = read_json(public / 'music' / 'sources.json')
    downloads = {f"public/{t.get('dir', 'music')}/{t['file']}": t for t in sources['tracks'] if t.get('distribution') == 'download'}
    for path in sorted(public.rglob('*')):
        relative = path.relative_to(public).as_posix()
        if path.is_file() and not excluded(relative) and any(relative.startswith(p) for p in info['publicPrefixes']):
            if 'public/' + relative not in downloads:
                add('public/' + relative)
    for path in sorted((public / 'music').glob('*')):
        if path.name.endswith('.beats.json') or path.name in ('sources.json', 'README.md'):
            add('public/music/' + path.name)

    # Music the inputs name: bundled audio travels, download-only audio is listed.
    wanted = []
    refs = set(strings(props)) | set(strings(catalog['defaultProps'])) | {t['src'] for t in catalog.get('check', {}).get('tracks', [])}
    for record_path, track in downloads.items():
        if record_path[len('public/'):] in refs or template in track.get('templates', []):
            wanted.append({'path': record_path, 'url': track['url'], 'bytes': track['bytes'], 'sha256': track['sha256'],
                           'title': track.get('title'), 'author': track.get('author'), 'license': track.get('license'),
                           'source': track.get('source')})
    for ref in sorted(refs):
        if re.fullmatch(r'(music|sfx)/[^/]+\.(mp3|ogg|wav|m4a)', ref) and 'public/' + ref not in downloads and (public / ref).is_file():
            add('public/' + ref)

    # Demo photos the inputs use.
    assets = read_json(kit / 'assets.json')
    known = {item['id']: item for item in assets['items']}
    used = referenced_ids(props, known)
    items = [known[i] for i in sorted(used)]
    for item in items:
        add('public/' + item['file'])
    files['assets.json'] = dump({'version': assets.get('version', '0.1'), 'items': items})
    props = dict(props)
    props.setdefault('format', catalog['defaultFormat'])
    files['inputs.json'] = dump({'template': template, 'props': props})
    if fixture_rel:
        add(fixture_rel)
    files['schema/props.schema.json'] = dump(info['schema'])

    readme = next((p for p in info['code'] if p.startswith('src/templates/') and p.endswith('/README.md')), None)
    if preview:
        files['preview/preview.mp4'] = Path(preview).read_bytes()
    if poster:
        files['preview/poster.jpg'] = Path(poster).read_bytes()
    for item in evidence:
        report = read_json(item)
        if not isinstance(report, dict) or not report.get('fingerprint'):
            fail('PACK_EVIDENCE', f'{item}: expected a check record with the rendered fingerprint (vvv.py evidence).')
        files[f'check/{Path(item).name}'] = dump(report)

    runtime = read_json(kit / 'package.json')['dependencies'].get('remotion')
    manifest = {
        'vvvFormat': FORMAT, 'kind': kind, 'name': name, 'version': version,
        'title': catalog.get('title', template), 'description': catalog.get('description', ''),
        'authors': meta.get('authors', []), 'license': meta.get('license', 'MIT'),
        'runtime': {'engine': 'remotion', 'version': runtime},
        'entry': 'src/index.tsx', 'inputs': 'inputs.json', 'assets': 'assets.json',
        'template': {'id': template, 'composition': catalog['compositionId'], 'catalog': f'catalog/{template}.json',
                     'formats': catalog['formats'], 'defaultFormat': catalog['defaultFormat'],
                     'music': catalog.get('music', {'required': False}), 'slots': catalog['slots'],
                     'sample': catalog['sample']},
        'schema': 'schema/props.schema.json', 'agents': 'AGENTS.md', 'licenses': 'licenses.json',
        'downloads': wanted,
        'workflow': {'mode': 'sample-first', 'stage': kind, 'approvedConstraints': []},
    }
    if kind == 'effect':
        source = f'src/effects/{template}/'
        manifest['effect'] = {'id': template, 'source': source, 'exports': (catalog.get('effect') or {}).get('exports', []),
                              'public': sorted(p for p in files if p.startswith('public/') and not p.startswith(('public/fonts/', 'public/photos/', 'public/music/'))),
                              'fonts': sorted(modules)}
        if not any(p.startswith(source) for p in files):
            fail('PACK_EFFECT', f'{source} is not reachable from the effect demo.')
    if preview or poster:
        manifest['preview'] = {k: v for k, v in (('video', 'preview/preview.mp4' if preview else None),
                                                 ('poster', 'preview/poster.jpg' if poster else None)) if v}
    files['AGENTS.md'] = agents_text(manifest, readme, packaged=True)
    files['CLAUDE.md'] = b'@AGENTS.md\n'
    files['README.md'] = (kit / readme).read_bytes() if readme else f'# {manifest["title"]}\n\n{manifest["description"]}\n'.encode('utf-8')
    files['.gitignore'] = (b'node_modules/\nout/\nbuild/\n.DS_Store\n'
                           b'# Download-only music and effects; fetched by npm run music\npublic/music/mixkit-*.mp3\npublic/sfx/mixkit-*.wav\n')
    finish(files, manifest, rules, kind)
    result = write_archive(files, output)
    return {'status': 'packed', 'kind': kind, 'name': name, 'version': version, **result,
            'downloads': len(wanted), 'fonts': sorted(modules), 'photos': len(items)}


# ---------------------------------------------------------------------------------- project packing


def pack_project(project, output, strip_media=False):
    from vvv_project import FORMAT as PROJECT_FORMAT, download_records, download_path
    project = Path(project).expanduser().resolve()
    manifest = read_json(project / 'vvv.json')
    inputs = read_json(project / 'inputs.json')
    # ``collect_dir`` intentionally excludes ``out/`` because rendered media do
    # not belong in a package.  Reports are the one exception and are copied
    # below, so inspect this directory before following it: a linked ``out/``
    # could otherwise make the report glob read files outside the project.
    out = project / 'out'
    if out.is_symlink():
        fail('PACK_SYMLINK', 'out')
    files = collect_dir(project)
    # Render reports travel with a project; rendered media and template publication records do not.
    if out.is_dir():
        for report in sorted(out.glob('*.report.json')):
            if report.is_symlink():
                fail('PACK_SYMLINK', report.relative_to(project).as_posix())
            if not report.is_file():
                fail('PACK_REPORT', report.relative_to(project).as_posix())
            files['out/' + report.name] = report.read_bytes()
    for relative in [p for p in files if p in ('integrity.json', 'licenses.json') or p.startswith(('check/', 'preview/'))]:
        del files[relative]
    refs = set(strings(inputs.get('props', {})))
    downloads = []
    for record in download_records(project):
        relative = 'public/' + download_path(record)
        files.pop(relative, None)
        if download_path(record) in refs or inputs.get('template') in record.get('templates', []):
            downloads.append({'path': relative, 'url': record['url'], 'bytes': record['bytes'], 'sha256': record['sha256'],
                              'title': record.get('title'), 'author': record.get('author'),
                              'license': record.get('license'), 'source': record.get('source')})
    stripped = []
    if strip_media:
        for item in read_json(project / 'assets.json').get('items', []):
            relative = 'public/' + item['file']
            if files.pop(relative, None) is not None:
                stripped.append(relative)
        for relative in [p for p in files if p.startswith('creative/') and p.endswith(('.jpg', '.jpeg', '.png'))]:
            del files[relative]
            stripped.append(relative)
    rules_path = project / 'package-licenses.json'
    if not rules_path.is_file():
        fail('PACK_LICENSE', 'The project has no package-licenses.json; copy it from the kit.')
    rules = read_json(rules_path)['rules']
    # vvv.json is not fingerprinted, so these package fields leave the project's render reports current.
    packaged = {'vvvFormat': PROJECT_FORMAT, 'kind': 'project', 'id': manifest.get('id', project.name),
                'version': manifest.get('version') if manifest.get('vvvFormat') else '0.1.0',
                **{k: v for k, v in manifest.items() if k not in ('version', 'vvvFormat', 'kind', 'profile')},
                'runtime': manifest.get('runtime') or {'engine': 'remotion',
                                                       'version': (manifest.get('profile') or {}).get('version')},
                'downloads': downloads}
    if stripped:
        packaged['strippedMedia'] = sorted(stripped)
    files['AGENTS.md'] = project_agents(files.get('AGENTS.md'), agents_text(packaged, 'PROJECT.md' if 'PROJECT.md' in files else None,
                                                                         packaged=True))
    files.setdefault('CLAUDE.md', b'@AGENTS.md\n')
    finish(files, packaged, rules, 'project')
    result = write_archive(files, output)
    personal = [p for p in files if p.startswith('public/photos/')]
    return {'status': 'packed', 'kind': 'project', 'id': packaged['id'], **result,
            'downloads': len(downloads), 'strippedMedia': len(stripped),
            'warning': (f"This package contains {len(personal)} of the owner's photos. Share it only with people the owner "
                        'has chosen; use --strip-media to share the structure alone.') if personal else None}


# ------------------------------------------------------------------------------------- verifying


def fingerprint_of(entries, downloads):
    """The project fingerprint (vvv_project.project_fingerprint) of the unpacked package, with downloads fetched."""
    from vvv_project import FINGERPRINT_PATHS
    digests = {}
    for path, digest in entries.items():
        top = path.split('/')[0]
        if path in FINGERPRINT_PATHS or (top in FINGERPRINT_PATHS and '/' in path):
            if path.split('/')[-1] not in ('.DS_Store',) and '__pycache__' not in path.split('/'):
                digests[path] = bytes.fromhex(digest)
    for item in downloads:
        digests[item['path']] = bytes.fromhex(item['sha256'])
    value = hashlib.sha256()
    for path in sorted(digests, key=lambda p: p.encode('utf-8')):  # UTF-8 byte order, as in vvv_project
        value.update(path.encode('utf-8'))
        value.update(b'\0')
        value.update(digests[path])
    return value.hexdigest()


def verify_package(path):
    """Check a .vvv without extracting or running it. Returns {status, checks, manifest summary}."""
    path = Path(path).expanduser()
    checks = []

    def check(code, ok, message, **details):
        checks.append({'code': code, 'status': 'passed' if ok is True else ('warning' if ok == 'warning' else 'failed'),
                       'message': message, **details})
        return ok is True

    if not path.is_file() or path.is_symlink():
        fail('PACKAGE_MISSING', str(path))
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as error:
        fail('PACKAGE_INVALID', f'Cannot read ZIP file: {error}.')
    with archive:
        try:
            infos = archive.infolist()
        except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError) as error:
            return {'status': 'failed', 'checks': [{'code': 'CONTAINER', 'status': 'failed',
                                                     'message': f'Cannot read ZIP entries: {error}.'}]}
        names = [i.filename for i in infos]
        first = infos[0] if infos else None
        try:
            with open(path, 'rb') as handle:
                head = handle.read(38 + len(MIMETYPE))
        except OSError as error:
            return {'status': 'failed', 'checks': [{'code': 'CONTAINER', 'status': 'failed',
                                                     'message': f'Cannot read ZIP header: {error}.'}]}
        try:
            mimetype = archive.read('mimetype') if first and first.filename == 'mimetype' else None
        except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
            mimetype = None
        check('MIMETYPE', bool(first) and first.filename == 'mimetype' and first.compress_type == zipfile.ZIP_STORED and
              mimetype == MIMETYPE.encode('ascii') and head[30:38] == b'mimetype' and
              head[38:] == MIMETYPE.encode('ascii'),
              f'The first entry is an uncompressed mimetype file containing {MIMETYPE}.')
        unsafe = []
        for info in infos:
            try:
                safe_member(info.filename)
            except PackageError as error:
                unsafe.append(str(error))
            mode = info.external_attr >> 16
            file_type = stat.S_IFMT(mode)
            if info.is_dir():
                unsafe.append(f'DIRECTORY: {info.filename}')
            elif file_type not in (0, stat.S_IFREG):
                unsafe.append(f'NON_REGULAR: {info.filename}')
            if stat.S_ISLNK(mode):
                unsafe.append(f'SYMLINK: {info.filename}')
            if info.flag_bits & 0x1:
                unsafe.append(f'ENCRYPTED: {info.filename}')
        folded = [n.casefold() for n in names]
        if len(set(folded)) != len(folded):
            unsafe.append('DUPLICATE: two entries differ only by case or repeat')
        regular_names = {info.filename for info in infos if not info.is_dir()}
        for name in sorted(regular_names):
            parts = name.split('/')
            prefixes = ('/'.join(parts[:index]) for index in range(1, len(parts)))
            conflict = next((prefix for prefix in prefixes if prefix in regular_names), None)
            if conflict:
                unsafe.append(f'PREFIX_CONFLICT: {conflict} and {name}')
        check('PATHS', not unsafe, 'All entries are safe relative paths without links or duplicates.'
              if not unsafe else '; '.join(unsafe[:8]))
        total = sum(i.file_size for i in infos)
        packed = sum(i.compress_size for i in infos) or 1
        biggest = max((i.file_size for i in infos), default=0)
        within = len(infos) <= LIMITS['entries'] and total <= LIMITS['bytes'] and biggest <= LIMITS['file'] and total / packed <= LIMITS['ratio']
        check('LIMITS', within, f'{len(infos)} entries, {total} bytes unpacked, ratio {total / packed:.1f}.',
              entries=len(infos), bytes=total)
        if not all(c['status'] == 'passed' for c in checks):
            return {'status': 'failed', 'checks': checks}

        def load(name):
            try:
                return json.loads(archive.read(name).decode('utf-8'))
            except (KeyError, ValueError, UnicodeDecodeError, OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
                return None

        required_entries = ('mimetype', 'vvv.json', 'integrity.json', 'licenses.json', 'AGENTS.md')
        missing_entries = [name for name in required_entries if name not in names]
        check('LAYOUT', not missing_entries,
              'The package contains its required entries.' if not missing_entries else
              f'Missing required entries: {missing_entries}.')

        manifest = load('vvv.json')
        ok = isinstance(manifest, dict) and manifest.get('vvvFormat') == FORMAT and manifest.get('kind') in KINDS
        check('MANIFEST', ok, f'vvv.json declares vvvFormat {FORMAT} and a kind.' if ok else
              'vvv.json is missing, unreadable, or not vvvFormat 1.0 with kind template|project|effect.')
        if not ok:
            return {'status': 'failed', 'checks': checks}
        schema_errors = validate_manifest_schema(manifest)
        check('MANIFEST_SCHEMA', not schema_errors,
              'vvv.json satisfies the bundled JSON Schema.' if not schema_errors else
              '; '.join(schema_errors[:12]) + (' …' if len(schema_errors) > 12 else ''))
        kind = manifest['kind']
        problems = []
        if not isinstance(manifest.get('version'), str) or not SEMVER.fullmatch(manifest['version']):
            problems.append('version must be a semantic version')
        if kind == 'project' and not isinstance(manifest.get('id'), str):
            problems.append('id must be a string for project packages')
        if kind in ('template', 'effect'):
            if not isinstance(manifest.get('name'), str) or not NAME.fullmatch(manifest['name']):
                problems.append('name must look like @scope/name')
            template = manifest.get('template')
            if not isinstance(template, dict):
                problems.append('template must be an object')
                template = {}
            elif not isinstance(template.get('id'), str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', template['id']):
                problems.append('template.id must be a lowercase identifier')
            catalog = load(template.get('catalog', '')) if isinstance(template.get('catalog'), str) else None
            if not isinstance(catalog, dict) or catalog.get('id') != template.get('id') or catalog.get('formats') != template.get('formats'):
                problems.append('template.catalog must exist and agree with template.id and template.formats')
            if manifest.get('schema') not in names:
                problems.append('schema file is missing')
        if kind == 'effect':
            effect = manifest.get('effect')
            if not isinstance(effect, dict):
                problems.append('effect must be an object')
            else:
                if not isinstance(effect.get('id'), str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', effect['id']):
                    problems.append('effect.id must be a lowercase identifier')
                source = effect.get('source')
                if (not isinstance(source, str) or
                        not re.fullmatch(r'src/effects/[a-z0-9][a-z0-9-]*/', source) or
                        source.split('/')[2] != effect.get('id')):
                    problems.append('effect.source must point inside src/effects')
        for key in ('entry', 'inputs', 'assets'):
            if not isinstance(manifest.get(key), str) or manifest.get(key) not in names:
                problems.append(f'{key} file {manifest.get(key)!r} is missing')
        downloads = manifest.get('downloads', [])
        invalid_downloads = []
        download_paths = set()
        if isinstance(downloads, list):
            for index, item in enumerate(downloads):
                if not (isinstance(item, dict) and isinstance(item.get('path'), str) and
                        re.fullmatch(r'[0-9a-f]{64}', str(item.get('sha256', ''))) and
                        isinstance(item.get('url'), str)):
                    invalid_downloads.append(index)
                    continue
                if item['path'] in download_paths or ('bytes' in item and
                                                       (not isinstance(item['bytes'], int) or isinstance(item['bytes'], bool) or
                                                        item['bytes'] < 0)):
                    invalid_downloads.append(index)
                download_paths.add(item['path'])
                try:
                    safe_member(item['path'])
                except PackageError:
                    invalid_downloads.append(index)
        else:
            invalid_downloads.append('not-a-list')
        if invalid_downloads:
            problems.append('downloads must list path, url and sha256')
            downloads = []
        present = [d['path'] for d in downloads if d['path'] in names]
        if present:
            problems.append('download-only files are inside the package: ' + ', '.join(present))
        check('CONTENTS', not problems, 'Manifest, entry, inputs, catalog and schema agree.' if not problems else '; '.join(problems))

        integrity = load('integrity.json')
        integrity_shape = isinstance(integrity, dict) and isinstance(integrity.get('files'), dict)
        listed = integrity.get('files', {}) if integrity_shape else {}
        actual = {}
        bad = []
        for info in infos:
            if info.filename in ('mimetype', 'integrity.json') or info.is_dir():
                continue
            try:
                data = archive.read(info)
            except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
                bad.append(info.filename)
                continue
            actual[info.filename] = sha256(data)
            record = listed.get(info.filename)
            record_ok = (isinstance(record, dict) and
                         isinstance(record.get('bytes'), int) and not isinstance(record.get('bytes'), bool) and
                         record.get('bytes') >= 0 and
                         isinstance(record.get('sha256'), str) and
                         re.fullmatch(r'[0-9a-f]{64}', record['sha256']) is not None and
                         record['sha256'] == actual[info.filename] and record['bytes'] == len(data))
            if not record_ok:
                bad.append(info.filename)
        missing = sorted(set(listed) - set(actual))
        check('INTEGRITY', integrity_shape and not bad and not missing,
              'Every file matches integrity.json.' if integrity_shape and not bad and not missing else
              f'Changed, malformed or unlisted: {bad[:8]}; listed but absent: {missing[:8]}.')

        licenses = load('licenses.json')
        license_shape = isinstance(licenses, dict) and isinstance(licenses.get('rules'), list) and isinstance(licenses.get('files'), dict)
        license_rules = licenses.get('rules', []) if license_shape else []
        mapped = licenses.get('files', {}) if license_shape else {}
        rules = {r.get('id'): r for r in license_rules if isinstance(r, dict) and isinstance(r.get('id'), str)}
        unlicensed = [p for p in actual if p not in ('licenses.json',) and p not in mapped]
        unknown_rules = [p for p, rule in mapped.items() if not isinstance(rule, str) or rule not in rules]
        mapping_extras = [p for p in mapped if p == 'licenses.json' or p not in actual]
        unsafe_mappings = []
        for file_name in mapped:
            try:
                safe_member(file_name)
            except PackageError:
                unsafe_mappings.append(file_name)
        restricted = []
        for file_name, rule_name in mapped.items():
            rule = rules.get(rule_name)
            if not rule:
                continue
            redistribution = rule.get('redistribute')
            if redistribution is False or (redistribution is not True and not (kind == 'project' and redistribution == 'owner')):
                restricted.append(file_name)
        lic_ok = (license_shape and not unlicensed and not unknown_rules and not mapping_extras and
                  not unsafe_mappings and not restricted)
        check('LICENSES', lic_ok, 'Every file names its terms in licenses.json.' if lic_ok else
              f'Unlicensed: {unlicensed[:6]}; unknown rules: {unknown_rules[:6]}; extra or unsafe mappings: '
              f'{(mapping_extras + unsafe_mappings)[:6]}; restricted: {restricted[:6]}.')

        evidence = []
        expected = fingerprint_of(actual, downloads)
        input_path = manifest.get('inputs', 'inputs.json')
        packaged_inputs = load(input_path) if isinstance(input_path, str) else None
        if not isinstance(packaged_inputs, dict):
            packaged_inputs = {}

        def without_format(document):
            if not isinstance(document, dict):
                return {}
            document = json.loads(json.dumps(document or {}))
            props = document.get('props')
            if isinstance(props, dict):
                props.pop('format', None)
            elif props is not None:
                document['props'] = {}
            return document

        for name in sorted(n for n in names if n.startswith('check/') and n.endswith('.json')):
            record = load(name)
            record = record if isinstance(record, dict) else {}
            check_record = record.get('check')
            check_record = check_record if isinstance(check_record, dict) else {}
            measured = expected
            if isinstance(record.get('inputs'), dict) and without_format(record['inputs']) == without_format(packaged_inputs):
                variant = dict(actual)
                if isinstance(input_path, str):
                    variant[input_path] = sha256(dump(record['inputs']))
                measured = fingerprint_of(variant, downloads)
            evidence.append({'file': name, 'status': check_record.get('status'),
                             'format': record.get('format'), 'range': record.get('range'), 'mode': record.get('mode'),
                             'current': record.get('fingerprint') == measured})
        if evidence:
            stale = [e['file'] for e in evidence if not e['current']]
            check('EVIDENCE', True if not stale else 'warning',
                  'Check records match the packaged files.' if not stale else
                  f'Check records were measured on different files: {stale}.')
        summary = {k: manifest.get(k) for k in ('kind', 'name', 'version', 'id', 'title', 'description', 'runtime')
                   if manifest.get(k) is not None}
        if isinstance(manifest.get('template'), dict):
            summary['template'] = {k: manifest['template'].get(k) for k in ('id', 'composition', 'formats', 'defaultFormat')}
        try:
            package_bytes = path.stat().st_size
        except OSError:
            package_bytes = None
        summary.update({'files': len(actual), 'bytes': package_bytes, 'downloads': len(downloads),
                        'evidence': evidence, 'fingerprint': expected, 'strippedMedia': manifest.get('strippedMedia', [])})
    failed = any(c['status'] == 'failed' for c in checks)
    return {'status': 'failed' if failed else 'passed', 'package': summary, 'checks': checks}


def inspect_package(path):
    """The manifest and file list only: what an agent needs to decide whether to open a package."""
    report = verify_package(path)
    try:
        with zipfile.ZipFile(Path(path).expanduser()) as archive:
            try:
                manifest = json.loads(archive.read('vvv.json').decode('utf-8'))
            except (KeyError, ValueError, UnicodeDecodeError, OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
                manifest = None
            try:
                agents = archive.read('AGENTS.md').decode('utf-8', 'replace') if 'AGENTS.md' in archive.namelist() else None
            except (KeyError, OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
                agents = None
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError):
        manifest = None
        agents = None
    return {'status': report['status'], 'manifest': manifest, 'agents': agents, 'checks': report['checks']}


# ------------------------------------------------------------------------------------- unpacking


def extract_into(path, directory):
    """Verify, then write every entry under an existing empty directory. Returns the verify report."""
    report = verify_package(path)
    if report['status'] == 'failed':
        failed = [c['code'] + ': ' + c['message'] for c in report['checks'] if c['status'] == 'failed']
        fail('PACKAGE_INVALID', '; '.join(failed))
    directory = Path(directory)
    root = directory.resolve()
    try:
        with zipfile.ZipFile(Path(path).expanduser()) as archive:
            for info in archive.infolist():
                if info.filename == 'mimetype' or info.is_dir():
                    continue
                target = directory / safe_member(info.filename)
                if root not in target.resolve().parents:
                    fail('UNSAFE_PATH', info.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, open(target, 'wb') as sink:
                    shutil.copyfileobj(source, sink)
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, zlib.error, EOFError) as error:
        fail('PACKAGE_INVALID', f'Cannot extract package: {error}.')
    return report


def unpack(path, output):
    output = Path(output).expanduser().absolute()
    if output.exists() or output.is_symlink():
        fail('DESTINATION_EXISTS', output.name)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f'.{output.name}-', dir=output.parent))
    try:
        report = extract_into(path, temporary)
        temporary.rename(output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {'status': 'unpacked', 'path': str(output), 'package': report['package'],
            'next': 'npm ci, then npm run music, then npm run sample.'}


IMPORT = re.compile(r'''(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]''')


def code_closure(entries, start):
    """Package files a module needs, following relative imports through the package's own file list."""
    seen, todo = set(), [start]
    while todo:
        current = todo.pop()
        if current in seen or current not in entries:
            continue
        seen.add(current)
        if not current.endswith(('.ts', '.tsx', '.js', '.mjs')):
            continue
        for match in IMPORT.finditer(entries[current].decode('utf-8', 'replace')):
            spec = match.group(1) or match.group(2)
            base = PurePosixPath(current).parent
            target = os.path.normpath(str(base / spec)).replace(os.sep, '/')
            for ext in ('', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx'):
                if target + ext in entries:
                    todo.append(target + ext)
                    break
    return seen


def add_effect(project, package):
    """Copy an effect package's component, the code it needs, its assets and fonts into a project."""
    project = Path(project).expanduser().resolve()
    if not (project / 'vvv.json').is_file():
        fail('PROJECT_MISSING', 'Add effects to a VVV project directory (one with vvv.json).')
    report = verify_package(package)
    if report['status'] == 'failed':
        fail('PACKAGE_INVALID', '; '.join(c['code'] + ': ' + c['message'] for c in report['checks'] if c['status'] == 'failed'))
    with zipfile.ZipFile(Path(package).expanduser()) as archive:
        entries = {i.filename: archive.read(i) for i in archive.infolist() if not i.is_dir() and i.filename != 'mimetype'}
    manifest = json.loads(entries['vvv.json'])
    if manifest.get('kind') != 'effect':
        fail('PACKAGE_KIND', f"add needs an effect package; this is a {manifest.get('kind')} package.")
    effect = manifest['effect']
    source = effect['source']
    wanted = {p for p in entries if p.startswith(source) and not p.endswith('/demo.tsx')}
    wanted |= {p for p in code_closure(entries, source + 'index.tsx') if p.startswith('src/')}
    wanted |= set(effect.get('public', []))
    added, kept, conflicts = [], [], []
    for relative in sorted(wanted):
        target = project / safe_member(relative)
        if target.is_symlink():
            fail('PROJECT_SYMLINK', relative)
        if target.exists():
            if target.read_bytes() == entries[relative]:
                continue
            (conflicts if relative.startswith(source) else kept).append(relative)
            continue
        added.append(relative)
    if conflicts:
        fail('EFFECT_EXISTS', f'The project already has a different {source}: {conflicts[:6]}. Remove or rename it first.')
    for relative in added:
        target = project / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(entries[relative])
    # Fonts the effect names, merged into the project's local font table.
    fonts_path = project / 'font-sources.json'
    fonts_added = []
    if effect.get('fonts') and fonts_path.is_file() and 'font-sources.json' in entries:
        mine, theirs = read_json(fonts_path), json.loads(entries['font-sources.json'])
        have = {f['module'] for f in mine['families']}
        for module in effect['fonts']:
            if module in have:
                continue
            family = next((f for f in theirs['families'] if f['module'] == module), None)
            if not family:
                continue
            faces = [f for f in theirs['faces'] if f['module'] == module]
            licenses = [l for l in theirs['licenses'] if l['family'] == family['family']]
            for item in faces + licenses:
                target = project / 'public' / item['file']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(entries['public/' + item['file']])
            mine['families'].append(family)
            mine['faces'].extend(faces)
            mine['licenses'].extend(l for l in licenses if l['file'] not in {x['file'] for x in mine['licenses']})
            fonts_added.append(module)
        if fonts_added:
            fonts_path.write_bytes(dump(mine))
    record = read_json(project / 'vvv.json')
    effects = [e for e in record.get('effects', []) if e.get('id') != effect['id']]
    effects.append({'id': effect['id'], 'name': manifest['name'], 'version': manifest['version'], 'source': source})
    record['effects'] = effects
    (project / 'vvv.json').write_bytes(dump(record))
    return {'status': 'added', 'effect': manifest['name'], 'version': manifest['version'], 'source': source,
            'exports': effect.get('exports', []), 'added': added, 'keptProjectVersion': kept, 'fonts': fonts_added,
            'next': f"Import it in scene code, e.g. import {{ {', '.join(effect.get('exports') or ['…'])} }} from "
                    f"\"../../effects/{effect['id']}\"; see {source}README.md."}


def evidence_record(project, check_result, report=None):
    """A check result tied to the exact files it measured, for packing into check/."""
    from vvv_project import project_fingerprint
    project = Path(project).expanduser().resolve()
    inputs = read_json(project / 'inputs.json')
    report = report or {}
    return {'vvvFormat': FORMAT, 'measuredAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'fingerprint': report.get('fingerprint') or project_fingerprint(project),
            # The inputs it rendered: a package's evidence may differ from its inputs.json only in props.format.
            'inputs': inputs,
            'format': inputs.get('props', {}).get('format'), 'range': report.get('sourceTimeRange'),
            'mode': report.get('mode'), 'output': {k: report.get(k) for k in ('width', 'height', 'fps', 'durationSeconds',
                                                                               'fullDurationSeconds')} if report else None,
            'video': check_result.get('video'),
            'check': {'status': check_result.get('status'),
                      'checks': [{k: c.get(k) for k in ('code', 'status', 'message', 'stillShare', 'meanMs')
                                  if c.get(k) is not None} for c in check_result.get('checks', [])]}}
