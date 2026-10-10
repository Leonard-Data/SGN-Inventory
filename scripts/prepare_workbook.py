"""Read-only workbook profiling and optional local staging. Never connects to a database.
Usage: python scripts/prepare_workbook.py /secure/Databases.xlsx --out /secure/import-run [--stage]
Password/Login content is intentionally discarded. Staging JSONL contains personal data.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import uuid
from zoneinfo import ZoneInfo
import openpyxl

TZ = ZoneInfo('Asia/Ho_Chi_Minh')
STATUS = {'Tạo mới':'draft','Đang bán':'available','Đã bán':'sold','Ngưng Bán':'withdrawn',
          'Đang Thương lượng':'negotiating','Đang giao dịch':'negotiating'}
DIRECTION = {'Bắc':'N','Đông Bắc':'NE','Đông':'E','Đông Nam':'SE','Nam':'S','Tây Nam':'SW','Tây':'W','Tây Bắc':'NW'}
MODE = {'caee82465r':'sale','caee82465b':'rent'}
ACCESS = {'Mặt tiền':'street_front','Mặt Tiền':'street_front','Hẻm ô tô':'car_alley',
          'Hẻm xe máy':'motorbike_alley','Ba Gác':'three_wheeler_alley'}
TYPE = {'Nhà':'house','Nhà nát':'house','Đất ở':'land','Chung cư':'apartment',
        'Vila/ Biệt thự':'villa','Căn hộ dịch vụ':'serviced_apartment'}
ROLE = {'Nhân viên sale':'sales','nhân viên sale':'sales','Thư ký':'staff','TPKD':'manager','Admin':'admin'}
REF_FIELDS = {'Contracts':'PropertyID','Historical':'Dự án','Attachments':'PropertyID','clicks':'Dự án'}

def sanitize_payload(headers,values):
    return {h:(v.isoformat() if isinstance(v,datetime) else v) for h,v in zip(headers,values)
            if h and h.lower() not in ('password','username')}

def text(value):
    return '' if value is None else str(value).strip()

def number(value):
    if value is None or text(value) == '': return None
    s = text(value).replace(' ','')
    # Accept a plain decimal dot OR decimal comma, never guess mixed/thousand notation.
    if not re.fullmatch(r'[+-]?\d+(?:[.,]\d+)?', s): raise ValueError('ambiguous_number')
    try: return Decimal(s.replace(',','.'))
    except InvalidOperation as exc: raise ValueError('invalid_number') from exc

def money(value, multiplier):
    d = number(value)
    if d is None: return None
    if d < 0: raise ValueError('negative_money')
    d *= multiplier
    if d != d.to_integral_value(): raise ValueError('fractional_vnd')
    if d > Decimal('999999999999999999'): raise ValueError('money_overflow')
    return str(int(d))

def local_time(value):
    if not text(value): return None
    dt = value if isinstance(value,datetime) else datetime.fromisoformat(text(value))
    if dt.tzinfo is None: dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(timezone.utc).isoformat()

def phones(value):
    raw = text(value)
    values, issues = [], []
    for part in re.split(r'\s*[-/;,\n]\s*',raw):
        if not part: continue
        compact = re.sub(r'[\s().]','',part)
        if re.fullmatch(r'0\d{9}',compact): compact = '+84'+compact[1:]
        elif re.fullmatch(r'84\d{9}',compact): compact = '+'+compact
        elif not re.fullmatch(r'\+84\d{9}',compact):
            issues.append('phone_needs_review');continue
        if compact not in values: values.append(compact)
    return values, sorted(set(issues))

def candidate(row):
    result={'listing_mode':MODE.get(text(row.get('Loại Hình'))),
            'property_type':TYPE.get(text(row.get('Loại Dự án')),'unclassified'),
            'access_type':ACCESS.get(text(row.get('Loại Dự án')),'unknown'),
            'status':STATUS.get(text(row.get('Tạo mới'))),
            'direction':DIRECTION.get(text(row.get('Hướng nhà'))),
            'legacy_address_text':text(row.get('Địa chỉ dự án')),
            'record_review_status':'pending','legal_status':'unknown'}
    issues=[]
    for src,dst,mult in [('Giá Bán (tỷ Đồng)','sale_price_vnd',Decimal('1000000000')),
                         ('Giá Thuê (triệu Đồng)','monthly_rent_vnd',Decimal('1000000'))]:
        try: result[dst]=money(row.get(src),mult)
        except ValueError as exc: issues.append(f'{dst}:{exc}')
    for src,dst in [('Chiều ngang','frontage_m'),('Chiều dài','depth_m')]:
        try:
            n=number(row.get(src))
            if n is not None and n <= 0: raise ValueError('non_positive_dimension')
            result[dst]=str(n) if n is not None else None
        except ValueError as exc: issues.append(f'{dst}:{exc}')
    area=text(row.get('Tổng diện tích'))
    # Only parse an explicit area unit; do not replace reported area by width * depth.
    m=re.match(r'^\s*(\d+(?:[.,]\d+)?)\s*m[²2]',area,re.I)
    if m:
        n=number(m.group(1))
        if n > 0: result['land_area_m2']=str(n)
        else: issues.append('non_positive_area')
    elif area: issues.append('area_needs_review')
    result['area_raw']=area
    result['phones'], phone_issues=phones(row.get('Số điện thoai'))
    issues.extend(phone_issues)
    for src,dst in [('Ngày Tạo','source_created_at'),('Ngày Chỉnh Sửa gần nhất','source_updated_at')]:
        try: result[dst]=local_time(row.get(src))
        except ValueError: issues.append(f'{dst}:invalid_datetime')
    if result['status'] is None: issues.append('unmapped_status')
    if result['listing_mode'] is None: issues.append('unmapped_listing_mode')
    if text(row.get('Loại Dự án')) not in set(ACCESS)|set(TYPE)|{'Không biết',''}: issues.append('unmapped_property_category')
    if text(row.get('Hướng nhà')) and result['direction'] is None: issues.append('unmapped_direction')
    # Never infer a new administrative address or commission reservation here.
    return result, sorted(set(issues))

def run(source,out,stage=False):
    sha=hashlib.sha256(source.read_bytes()).hexdigest()
    batch_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'sgn-workbook:'+sha))
    w=openpyxl.load_workbook(source,data_only=True,read_only=True)
    data={}
    for sheet in w:
        if sheet.title == 'Login': continue
        iterator=iter(sheet.values)
        headers=[text(x) for x in next(iterator)]
        records=[]
        for row_no,values in enumerate(iterator,2):
            if not any(x is not None for x in values): continue
            # Do not even stage Password, blank helper columns or credentials.
            payload=sanitize_payload(headers,values)
            records.append((row_no,payload))
        data[sheet.title]=records
    props=data['Thông tin dự án']
    ids=Counter(text(r.get('PropertyID')) for _,r in props if text(r.get('PropertyID')))
    duplicate_keys={k for k,n in ids.items() if n>1}
    eligible_keys={k for k,n in ids.items() if n==1}
    summary={'source_sha256':sha,'batch_id':batch_id,'sheets':{k:len(v) for k,v in data.items()},
             'excluded_sheets':['Login'],'excluded_fields':['Password','Username'],
             'properties':{'total_rows':len(props),'missing_id_rows':sum(not text(r.get('PropertyID')) for _,r in props),
               'distinct_nonblank_ids':len(ids),'duplicate_nonblank_keys':len(duplicate_keys),
               'rows_with_duplicate_nonblank_id':sum(ids[k] for k in duplicate_keys),
               'unique_id_rows_before_content_checks':len(eligible_keys)},'relationships':{},'issue_counts':{},
             'assumptions':['Naive source timestamps are interpreted in Asia/Ho_Chi_Minh; confirm before promotion.',
                            'New ward mappings, employee authority, and BDS aliases require separate review.']}
    issue_counts=Counter()
    out.mkdir(parents=True,exist_ok=True)
    stream=(out/'staging-rows.jsonl').open('w',encoding='utf-8') if stage else None
    try:
        for sheet,records in data.items():
            for row_no,payload in records:
                issues=[]; normalized=None; source_id=None
                if sheet=='Thông tin dự án':
                    source_id=text(payload.get('PropertyID')) or None
                    if source_id is None: issues.append('missing_property_id')
                    elif source_id in duplicate_keys: issues.append('duplicate_property_id')
                    normalized,extra=candidate(payload);issues.extend(extra)
                elif sheet in REF_FIELDS:
                    source_id=text(payload.get(REF_FIELDS[sheet])) or None
                    if source_id not in eligible_keys: issues.append('unresolved_property_reference')
                elif sheet=='Nhân viên':
                    source_id=text(payload.get('Email')).lower() or None
                    normalized={'email':source_id,'proposed_role':ROLE.get(text(payload.get('Chức Vụ'))),
                                'is_active':False,'auth_user_id':None}
                    if not source_id or '@' not in source_id: issues.append('invalid_employee_email')
                    if normalized['proposed_role'] is None: issues.append('unmapped_employee_role')
                    issues.append('employee_authority_requires_review')
                issue_counts.update(set(issues))
                if stream:
                    json.dump({'batch_id':batch_id,'sheet':sheet,'source_row':row_no,'source_id':source_id,
                      'payload':payload,'normalized_candidate':normalized,'issues':sorted(set(issues)),
                      'disposition':'pending'},stream,ensure_ascii=False,default=str)
                    stream.write('\n')
    finally:
        if stream: stream.close()
        w.close()
    for sheet,col in REF_FIELDS.items():
        refs=Counter(text(r.get(col)) for _,r in data[sheet])
        summary['relationships'][sheet]={'total_rows':sum(refs.values()),
          'direct_nonblank_match_rows':sum(n for k,n in refs.items() if k in ids),
          'unambiguous_direct_match_rows':sum(n for k,n in refs.items() if k in eligible_keys),
          'unresolved_or_ambiguous_rows':sum(n for k,n in refs.items() if k not in eligible_keys),
          'distinct_reference_values':len(refs)}
    summary['issue_counts']=dict(issue_counts)
    (out/'workbook-profile.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('workbook',type=Path);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--stage',action='store_true',help='Write local personal-data staging JSONL; never commit it')
    a=p.parse_args();summary=run(a.workbook,a.out,a.stage)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
