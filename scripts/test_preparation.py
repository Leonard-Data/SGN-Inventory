import unittest
from decimal import Decimal
from prepare_workbook import money, number, phones, local_time, candidate, sanitize_payload

class PreparationTests(unittest.TestCase):
    def test_vnd_conversion_preserves_sale_and_rent_units(self):
        self.assertEqual(money('19.90',Decimal('1000000000')),'19900000000')
        self.assertEqual(money('12,5',Decimal('1000000')),'12500000')
        self.assertEqual(money(0,Decimal('1000000')),'0')
        self.assertIsNone(money(None,Decimal('1000000')))
    def test_ambiguous_notation_is_not_guessed(self):
        for value in ['1.200,50','12 tỷ','-2']:
            with self.assertRaises(ValueError): money(value,Decimal('1000000000'))
        with self.assertRaises(ValueError): money('1000000000',Decimal('1000000000'))
    def test_area_is_not_overwritten_by_dimensions(self):
        result,issues=candidate({'Loại Hình':'caee82465r','Tạo mới':'Đang bán',
          'Tổng diện tích':'111.8m2 (4.3m x26m)','Chiều ngang':4,'Chiều dài':26})
        self.assertEqual(result['land_area_m2'],'111.8')
        self.assertNotIn('current_address',result)
        self.assertEqual(result['record_review_status'],'pending')
    def test_multiple_phones_and_invalid_values(self):
        values,issues=phones('0901234567 - 0341234567')
        self.assertEqual(values,['+84901234567','+84341234567'])
        self.assertEqual(issues,[])
        values,issues=phones('******4567')
        self.assertEqual(values,[])
        self.assertEqual(issues,['phone_needs_review'])
    def test_naive_vietnam_date_becomes_correct_utc_instant(self):
        self.assertEqual(local_time('2026-10-10 00:05:00'),'2026-10-09T17:05:00+00:00')
        self.assertEqual(local_time('2026-10-09T17:05:00+00:00'),'2026-10-09T17:05:00+00:00')
    def test_password_and_helper_columns_never_staged(self):
        payload=sanitize_payload(['Email','Password','Username',''],['fixture@example.test','test-secret','login','unused'])
        self.assertEqual(payload,{'Email':'fixture@example.test'})
    def test_unknown_status_and_type_do_not_become_available(self):
        result,issues=candidate({'Loại Hình':'bad','Tạo mới':'unexpected','Loại Dự án':'not-a-category'})
        self.assertIsNone(result['status'])
        self.assertIsNone(result['listing_mode'])
        self.assertEqual(result['property_type'],'unclassified')
        self.assertIn('unmapped_status',issues)
        self.assertIn('unmapped_property_category',issues)

if __name__ == '__main__': unittest.main()
