import unittest
from quality_frames import black_frame_check
class FrameTests(unittest.TestCase):
    def test_continuous_black_fails(self):
        self.assertEqual(black_frame_check(bytes(32*32*3*4))['status'],'failed')
    def test_normal_footage_passes(self):
        self.assertEqual(black_frame_check(bytes([120])*(32*32*3*4))['status'],'passed')
    def test_isolated_sample_is_not_a_stretch(self):
        dark=bytes(32*32*3);normal=bytes([120])*(32*32*3)
        self.assertEqual(black_frame_check(dark+normal+dark+normal)['status'],'passed')
    def test_truncated_samples_fail_closed(self):
        with self.assertRaises(ValueError):black_frame_check(bytes(5))
if __name__=='__main__':unittest.main()
