# -*- coding: utf-8 -*-
"""최근 1주일 서울교통공사_역별승하차인원 API를 집계해 app/_data/subway.json의
stations[].apiShare(표시 값)를 갱신. 색/기준용 2024 share·baseline2024는 유지.
GitHub Actions에서 매일 1회 실행. API 키는 환경변수 DATA_GO_KR_KEY 에서 읽는다."""
import json, os, time, urllib.request, urllib.error, sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

KEY = os.environ.get("DATA_GO_KR_KEY", "").strip()
BASE = "http://apis.data.go.kr/B553766/psgr/getStnPsgr"
SUBWAY = "app/_data/subway.json"
ROWS = 1000
KST = timezone(timedelta(hours=9))


def req(d, p):
    url = (f"{BASE}?serviceKey={KEY}&pasngYmd={d}"
           f"&numOfRows={ROWS}&pageNo={p}&dataType=JSON")
    for _ in range(4):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            print("  재시도", d, p, e)
            time.sleep(3)
    return None


def total_of(j):
    if not j:
        return -1
    if j["response"]["header"]["resultCode"] != "00":
        return -1
    return int(j["response"]["body"].get("totalCount") or 0)


if not KEY:
    print("DATA_GO_KR_KEY 환경변수가 없습니다.", file=sys.stderr)
    sys.exit(1)

# 데이터가 있는 최근 7일 탐색 (API 지연 고려: 어제부터 거슬러)
today = datetime.now(KST).date()
dates = []
firsts = {}
for i in range(1, 11):
    d = (today - timedelta(days=i)).strftime("%Y%m%d")
    j = req(d, 1)
    t = total_of(j)
    if t > 0:
        dates.append(d)
        firsts[d] = j
    if len(dates) >= 7:
        break
dates.sort()
print("대상 날짜:", dates)
if len(dates) < 3:
    print("가용 데이터가 부족해 갱신을 건너뜁니다.", file=sys.stderr)
    sys.exit(0)


def is_weekend(s):
    return datetime.strptime(s, "%Y%m%d").weekday() >= 5


acc = [defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])),
       defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))]

for d in dates:
    first = firsts[d]
    pages = (total_of(first) + ROWS - 1) // ROWS
    we = 1 if is_weekend(d) else 0
    print(f"[{d}] {'주말' if we else '평일'} {pages}p")
    for p in range(1, pages + 1):
        j = first if p == 1 else req(d, p)
        if not j:
            continue
        items = j["response"]["body"].get("items")
        if not items:
            continue
        rows = items["item"]
        if isinstance(rows, dict):
            rows = [rows]
        for it in rows:
            try:
                hr = int(it["pasngHr"])
            except (ValueError, TypeError):
                continue
            cnt = (it.get("rideNope") or 0) + (it.get("gffNope") or 0)
            b = acc[we][it["stnNm"]][hr]
            b[1] += cnt
            if it.get("trnscdUserSeCdNm") == "우대권":
                b[0] += cnt

sub = json.load(open(SUBWAY, encoding="utf-8"))
S = sub["stations"]
DT = ["wd", "we"]
for we in (0, 1):
    for stn, hours in acc[we].items():
        if stn not in S:
            continue
        ap = S[stn].setdefault("apiShare", {"wd": {}, "we": {}})
        ap[DT[we]] = {}
        for hr, (sen, tot) in hours.items():
            if tot > 0:
                ap[DT[we]][str(hr)] = round(100 * sen / tot, 2)

sub["meta"]["apiBasis"] = (
    f"표시 값: 서울교통공사_역별승하차인원 API ({dates[0]}~{dates[-1]}) "
    f"평일/주말 평균. 색/기준: 2024 평일 분포.")
sub["meta"]["apiUpdated"] = today.strftime("%Y-%m-%d")
json.dump(sub, open(SUBWAY, "w", encoding="utf-8"), ensure_ascii=False)
print("갱신 완료:", dates[0], "~", dates[-1])
