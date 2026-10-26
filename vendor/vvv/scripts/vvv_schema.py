"""A small, data-only JSON Schema validator shared by manifests and template inputs.

It implements the subset used by the bundled manifest schema and by the props schemas that
zod generates for templates, instead of importing a third-party validator. Keywords outside
that subset are ignored.
"""
from __future__ import annotations

import math
import re
from urllib.parse import urlsplit


def type_matches(value, expected):
    """bool is not an integer or number here, although Python treats it as an int subclass."""
    if expected == 'object':
        return isinstance(value, dict)
    if expected == 'array':
        return isinstance(value, list)
    if expected == 'string':
        return isinstance(value, str)
    if expected == 'boolean':
        return isinstance(value, bool)
    if expected == 'null':
        return value is None
    if expected == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == 'number':
        # json.loads accepts NaN and Infinity; the runtime schemas reject them.
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    return True


def pointer(root, reference):
    """Resolve a local JSON Pointer such as #/$defs/name."""
    if not isinstance(reference, str) or not reference.startswith('#/'):
        return None
    node = root
    for token in reference[2:].split('/'):
        token = token.replace('~1', '/').replace('~0', '~')
        if isinstance(node, dict) and token in node:
            node = node[token]
        elif isinstance(node, list) and token.isdigit() and int(token) < len(node):
            node = node[int(token)]
        else:
            return None
    return node


def is_uri(value):
    """Check the URI format used for download URLs without network access."""
    if not isinstance(value, str) or not value or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if not parsed.scheme:
        return False
    return parsed.scheme.lower() not in ('http', 'https') or bool(parsed.netloc)


def issues(value, schema, root=None, path='$'):
    """Return [(path, message)] for every violation found; an empty list means valid."""
    root = schema if root is None else root
    if schema is True:
        return []
    if not isinstance(schema, dict):
        return [(path, 'schema node is not an object')]
    if '$ref' in schema:
        target = pointer(root, schema['$ref'])
        if target is None:
            return [(path, f'unresolved schema reference {schema["$ref"]!r}')]
        return issues(value, target, root, path)

    found = []
    expected = schema.get('type')
    expected_types = expected if isinstance(expected, list) else [expected] if expected else []
    if expected_types and not any(type_matches(value, item) for item in expected_types):
        return [(path, f'expected {" or ".join(expected_types)}')]
    if 'const' in schema and value != schema['const']:
        found.append((path, f'must equal {schema["const"]!r}'))
    if 'enum' in schema and value not in schema['enum']:
        found.append((path, f'must be one of {schema["enum"]!r}'))

    if isinstance(value, dict):
        for required in schema.get('required', []):
            if required not in value:
                found.append((path, f'missing required property {required!r}'))
        properties = schema.get('properties', {})
        for key, child in properties.items():
            if key in value:
                found.extend(issues(value[key], child, root, f'{path}.{key}'))
        additional = schema.get('additionalProperties', True)
        if additional is False:
            for key in value:
                if key not in properties:
                    found.append((f'{path}.{key}', 'additional property is not allowed'))
        elif isinstance(additional, dict):
            for key, child_value in value.items():
                if key not in properties:
                    found.extend(issues(child_value, additional, root, f'{path}.{key}'))
    elif isinstance(value, list):
        minimum, maximum = schema.get('minItems'), schema.get('maxItems')
        if isinstance(minimum, int) and len(value) < minimum:
            found.append((path, f'must contain at least {minimum} items'))
        if isinstance(maximum, int) and len(value) > maximum:
            found.append((path, f'must contain at most {maximum} items'))
        if isinstance(schema.get('items'), dict):
            for index, item in enumerate(value):
                found.extend(issues(item, schema['items'], root, f'{path}[{index}]'))
    elif isinstance(value, str):
        minimum, maximum = schema.get('minLength'), schema.get('maxLength')
        if isinstance(minimum, int) and len(value) < minimum:
            found.append((path, f'must contain at least {minimum} characters'))
        if isinstance(maximum, int) and len(value) > maximum:
            found.append((path, f'must contain at most {maximum} characters'))
        pattern = schema.get('pattern')
        if isinstance(pattern, str):
            try:
                matches = re.search(pattern, value) is not None
            except re.error:
                matches = False
            if not matches:
                found.append((path, f'does not match {pattern!r}'))
        if schema.get('format') == 'uri' and not is_uri(value):
            found.append((path, 'must be a URI'))
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        for key, test, text in (('minimum', lambda v, b: v < b, '>='), ('maximum', lambda v, b: v > b, '<='),
                                ('exclusiveMinimum', lambda v, b: v <= b, '>'),
                                ('exclusiveMaximum', lambda v, b: v >= b, '<')):
            bound = schema.get(key)
            if isinstance(bound, (int, float)) and not isinstance(bound, bool) and test(value, bound):
                found.append((path, f'must be {text} {bound}'))

    branches = schema.get('anyOf')
    if isinstance(branches, list) and branches:
        results = [issues(value, branch, root, path) for branch in branches]
        if all(results):
            # Report the closest branch: the one with the fewest problems.
            found.extend(min(results, key=len))
    for branch in schema.get('allOf', []):
        if not isinstance(branch, dict):
            found.append((path, 'allOf contains a non-object schema'))
            continue
        condition = branch.get('if')
        if condition is not None:
            if not issues(value, condition, root, path):
                if 'then' in branch:
                    found.extend(issues(value, branch['then'], root, path))
            elif 'else' in branch:
                found.extend(issues(value, branch['else'], root, path))
        else:
            found.extend(issues(value, branch, root, path))
    return found


def errors(value, schema, root=None, path='$'):
    """The same violations as 'path: message' strings."""
    return [f'{where}: {message}' for where, message in issues(value, schema, root, path)]
