"""Local image intake. This module never alters original files."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

try:  # optional: HEIC/HEIF (iPhone) photos decode only with pillow-heif installed
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_SUPPORT = True
except Exception:
    HEIC_SUPPORT = False

IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.heic', '.heif'}
HEIC_SUFFIXES = {'.heic', '.heif'}
SKIP_DIRECTORIES = {'.git', 'node_modules', '.venv', '__pycache__'}


def diagnostic(code, message, location='', severity='warning'):
    return {'code': code, 'message': message, 'location': str(location), 'severity': severity}


def inventory_images(sources):
    """Keep explicit source order; sort folder members. Deduplicate exact content."""
    candidates, diagnostics = [], []
    for source in sources:
        path = Path(source).expanduser()
        if path.is_symlink():
            diagnostics.append(diagnostic('SYMLINK_SKIPPED', 'Symbolic links are not followed.', path.name))
            continue
        if not path.exists():
            diagnostics.append(diagnostic('SOURCE_MISSING', 'Source does not exist.', path.name, 'error'))
            continue
        if path.is_dir():
            for directory, names, files in os.walk(path, followlinks=False):
                for name in list(names):
                    child = Path(directory) / name
                    if child.is_symlink():
                        diagnostics.append(diagnostic('SYMLINK_SKIPPED', 'Symbolic links are not followed.', child.name))
                names[:] = sorted(n for n in names if n not in SKIP_DIRECTORIES and
                                   not n.startswith('.') and not (Path(directory) / n).is_symlink())
                candidates.extend((Path(directory) / n, str((Path(directory) / n).relative_to(path)))
                                  for n in sorted(files) if not n.startswith('.'))
        elif path.is_file():
            candidates.append((path, path.name))
    items, hashes = [], set()
    for path, label in candidates:
        if path.is_symlink():
            diagnostics.append(diagnostic('SYMLINK_SKIPPED', 'Symbolic links are not followed.', label))
            continue
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            diagnostics.append(diagnostic('UNSUPPORTED_FILE', 'Not a supported still-image candidate.', label))
            continue
        if path.suffix.lower() in HEIC_SUFFIXES and not HEIC_SUPPORT:
            diagnostics.append(diagnostic('HEIC_UNSUPPORTED', 'Cannot decode HEIC/HEIF here: convert to JPEG or install '
                                          'pillow-heif (pip install pillow-heif).', label))
            continue
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with Image.open(path) as image:
                if getattr(image, 'n_frames', 1) > 1:
                    diagnostics.append(diagnostic('ANIMATED_IMAGE_UNSUPPORTED',
                                                  'Animation needs an explicit video/image adapter.', label))
                    continue
                normalized = ImageOps.exif_transpose(image)
                normalized.load()
                width, height = normalized.size
                if width < 1 or height < 1:
                    raise ValueError('Empty dimensions')
            if digest in hashes:
                diagnostics.append(diagnostic('DUPLICATE_CONTENT', 'Identical image content was already listed.', label))
                continue
            hashes.add(digest)
            items.append({'id': f'photo-{digest[:16]}', 'path': path, 'name': label,
                          'sha256': digest, 'width': width, 'height': height})
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
            diagnostics.append(diagnostic('UNREADABLE_IMAGE', f'Cannot decode image: {error}', label))
    return items, diagnostics


def copy_normalized(items, public):
    folder = Path(public) / 'photos'
    folder.mkdir(parents=True, exist_ok=True)
    assets = []
    for item in items:
        with Image.open(item['path']) as source:
            normalized = ImageOps.exif_transpose(source)
            has_alpha = 'A' in normalized.getbands() or 'transparency' in normalized.info
            image = normalized.convert('RGBA' if has_alpha else 'RGB')
            suffix = '.png' if has_alpha else '.jpg'
            file = f"photos/{item['id']}{suffix}"
            image.save(public / file, **({'compress_level': 6} if has_alpha else {'quality': 95}))
        width, height = item['width'], item['height']
        assets.append({'id': item['id'], 'file': file, 'width': width, 'height': height,
                       'orientation': 'landscape' if width > height else 'portrait' if height > width else 'square',
                       'source': {'kind': 'local-image', 'name': item['name'], 'sha256': item['sha256']},
                       'processing': ['decode', 'normalize-exif-orientation'],
                       'faces': []})
    return assets


def contact_sheet(assets, public, destination):
    """A labeled technical index for the Agent's image selection, not new artwork."""
    from PIL import ImageDraw
    columns, cell_width, cell_height = 5, 280, 224
    rows = (len(assets) + columns - 1) // columns
    sheet = Image.new('RGB', (columns * cell_width, max(1, rows) * cell_height), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for index, asset in enumerate(assets):
        x, y = (index % columns) * cell_width, (index // columns) * cell_height
        with Image.open(public / asset['file']) as source:
            tile = source.convert('RGB')
            tile.thumbnail((cell_width - 16, cell_height - 34))
            sheet.paste(tile, (x + (cell_width - tile.width) // 2, y + 6))
        draw.text((x + 8, y + cell_height - 26), f"{index + 1:02d}  {asset['id']}", fill='#222222')
    sheet.save(destination, quality=88)
