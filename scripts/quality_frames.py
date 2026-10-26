"""Conservative near-black stretch detector on decoded RGB samples."""
def black_frame_check(data, width=32, height=32, rate=4):
    size = width * height * 3
    if not data or len(data) % size:
        raise ValueError('Incomplete decoded RGB frame samples')
    longest = current = 0
    for offset in range(0, len(data), size):
        frame = data[offset:offset + size]
        dark = sum(max(frame[p:p + 3]) <= 18 for p in range(0, size, 3))
        current = current + 1 if dark / (width * height) >= .98 else 0
        longest = max(current, longest)
    seconds = longest / rate
    return {'code': 'BLACK', 'status': 'failed' if seconds >= .5 else 'passed',
            'message': f'Longest sampled near-black stretch: {seconds:.2f}s at {rate}fps.',
            'longestSampledBlackSeconds': seconds, 'sampleRate': rate,
            'limits': 'Downscaled near-black full-frame check; does not assess exposure, intent or general visual quality.'}
