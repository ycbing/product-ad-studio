"""Environment check for the agent: what a render needs, and the exact step that fixes each gap.

Run before the first project command of a session. Every failed or warning check carries `next`:
`run` (the agent runs the command itself), `ask_user` (one sentence the user must answer, for
permission or a system install) or `fix` (the agent works it out). Nothing here installs anything.
"""
from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
import sys

NODE_MINIMUM = 22
NODE_VERIFIED = 26
REPOSITORY = 'https://github.com/actionow-ai/vvv.git'


def _version(command):
    try:
        output = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return output or None


def doctor(kit, project, run, ask_user, fix, script, requirements):
    checks = []

    def add(code, status, message, step=None):
        checks.append({'code': code, 'status': status, 'message': message, **({'next': step} if step else {})})

    python = '.'.join(map(str, sys.version_info[:3]))
    if sys.version_info >= (3, 9):
        add('PYTHON', 'passed', f'Python {python} at {sys.executable}.')
    else:
        add('PYTHON', 'failed', f'Python {python} is older than 3.9.',
            ask_user('The video tools need Python 3.9 or newer. May I install it?'))

    try:
        import PIL
        add('PILLOW', 'passed', f'Pillow {PIL.__version__}.')
    except ImportError:
        add('PILLOW', 'failed', f'Pillow is not installed for {sys.executable}.',
            run(sys.executable, '-m', 'pip', 'install', '-r', requirements,
                then='If pip refuses (an externally managed Python), create a virtual environment '
                     'and use its python for every vvv.py command.'))

    node = shutil.which('node')
    version = _version([node, '--version']) if node else None
    match = re.match(r'v(\d+)', version or '')
    if not node or not match:
        add('NODE', 'failed', 'Node.js is not installed; rendering needs it.',
            ask_user(f'Rendering needs Node.js {NODE_MINIMUM} or newer on this computer. May I install it?'))
    elif int(match.group(1)) < NODE_MINIMUM:
        add('NODE', 'failed', f'Node.js {version} is older than {NODE_MINIMUM}.',
            ask_user(f'Rendering needs Node.js {NODE_MINIMUM} or newer; this computer has {version}. May I upgrade it?'))
    elif int(match.group(1)) != NODE_VERIFIED:
        add('NODE', 'warning', f'Node.js {version}; renders are verified with Node.js {NODE_VERIFIED}. '
                               'Continue, and mention the version if a render fails.')
    else:
        add('NODE', 'passed', f'Node.js {version}.')

    if shutil.which('npm'):
        add('NPM', 'passed', 'npm is available.')
    elif node:
        add('NPM', 'failed', 'npm is missing although Node.js is installed.',
            ask_user('Node.js on this computer has no npm, which rendering needs. May I reinstall Node.js?'))

    if kit and (Path(kit) / 'catalog').is_dir():
        add('KIT', 'passed', f'Template kit at {Path(kit).resolve()}.')
    else:
        target = Path.home() / '.vvv' / 'vvv'
        add('KIT', 'failed', 'No template kit: --kit, $VVV_KIT and the kit beside the skill are all missing.',
            run('git', 'clone', '--depth', '1', REPOSITORY, str(target),
                then=f'Pass --kit {target / "kits" / "remotion"} to later commands, or set VVV_KIT to it.'))

    if project:
        _project_checks(Path(project).expanduser().resolve(), add, run, fix)
    elif shutil.which('ffmpeg'):
        add('FFMPEG', 'passed', 'ffmpeg is on PATH.')
    else:
        add('FFMPEG', 'warning', 'No ffmpeg on PATH. vvv check uses the one Remotion installs into a project, '
                                 'so pass --project once a project exists.')

    failed = [c for c in checks if c['status'] == 'failed']
    return {'status': 'failed' if failed else 'passed', 'checks': checks,
            **({'next': [c['next'] for c in failed]} if failed else {})}


def _project_checks(project, add, run, fix):
    if not (project / 'inputs.json').is_file():
        add('PROJECT', 'failed', f'{project} is not a vvv project (no inputs.json).',
            fix('Pass the project directory created by vvv.py init.'))
        return
    if (project / 'node_modules' / '@remotion' / 'renderer').is_dir():
        add('PROJECT_DEPENDENCIES', 'passed', 'Project dependencies are installed.')
    else:
        add('PROJECT_DEPENDENCIES', 'failed', 'Project dependencies are not installed.', run('npm', 'ci', cwd=project))
    try:
        from vvv_project import validate_project
        validation = validate_project(project)
    except ImportError:
        return  # Pillow is missing; that check already says how to fix it.
    status = validation['status']
    if status == 'pending':
        add('PROJECT_DOWNLOADS', 'failed', 'Download-only music or files are not fetched yet.',
            run('npm', 'run', 'music', cwd=project))
    elif status == 'failed':
        add('PROJECT_INPUTS', 'failed', 'The project inputs do not validate.',
            fix('Run validate for the failed checks, fix inputs.json, photos or music, and validate again.'))
    else:
        add('PROJECT_INPUTS', 'passed', 'Project inputs validate and downloads are present.')
