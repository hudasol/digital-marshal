"""docs/track_c/CROSS_MODEL_TRACK_C.md must agree with the result files it is generated from. Does not write any file."""
import unittest
import reconcile_track_c as rc


class TrackCReconciliationDocIsCurrent(unittest.TestCase):
    def setUp(self): self.doc, self.gen = rc.DOC.read_text(), rc.tables()

    def test_document_matches_the_generated_tables(self):
        self.assertTrue(rc.is_current(self.doc, self.gen), 'run: python tools/reconcile_track_c.py and paste between the markers')

    def test_a_changed_number_is_detected(self):
        row = next(l for l in self.gen.splitlines() if l.startswith('| near_branch_capacity | partially'))
        self.assertFalse(rc.is_current(self.doc.replace(row, row.replace('| partially comparable |', '| comparable |')), self.gen))

    def test_target_is_shown_unchanged_and_not_met_by_the_point_queue(self):
        self.assertEqual(rc.TARGET_PCT, 5.0)
        self.assertIn('| Point queue, frozen WP2.7 | 1.70 | 5 | no |', self.gen)

    def test_no_scenario_is_labelled_comparable(self):
        self.assertNotIn('| comparable |', self.gen)


if __name__ == '__main__':
    unittest.main()
