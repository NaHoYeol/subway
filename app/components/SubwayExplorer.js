"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import data from "../_data/subway.json";
import { stitchRoute } from "../lib/subwayRouting";
import {
  hourShares,
  percentile,
  topPercent,
  colorForP,
} from "../lib/subwayStats";
import { NO_DATA } from "../_data/noData";
import styles from "./SubwayExplorer.module.css";

const HOURS = data.meta.hours || Array.from({ length: 18 }, (_, i) => i + 6);

function verdict(top) {
  if (top <= 15) return { label: "유독 많음", cls: "vHigh" };
  if (top <= 40) return { label: "다소 많음", cls: "vMidHigh" };
  if (top <= 60) return { label: "평범", cls: "vMid" };
  if (top <= 85) return { label: "다소 적음", cls: "vMidLow" };
  return { label: "적음", cls: "vLow" };
}

// 입력했을 때만 일치 항목을 보여주는 자동완성 입력 (datalist 대체)
function AutoInput({ value, onChange, placeholder, options }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  const matches = useMemo(() => {
    const q = value.trim();
    if (!q) return [];
    const sw = [];
    const inc = [];
    for (const o of options) {
      if (o.name === q) continue;
      if (o.name.startsWith(q)) sw.push(o);
      else if (o.name.includes(q)) inc.push(o);
      if (sw.length + inc.length >= 40) break;
    }
    return [...sw, ...inc].slice(0, 10);
  }, [value, options]);

  const pick = (name) => {
    onChange(name);
    setOpen(false);
    setHi(-1);
  };

  return (
    <div className={styles.acWrap}>
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(-1);
        }}
        onFocus={() => value.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || !matches.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && hi >= 0) {
            e.preventDefault();
            pick(matches[hi].name);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className={styles.acList}>
          {matches.map((o, i) => (
            <li
              key={o.name}
              className={i === hi ? styles.acHi : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.name);
              }}
            >
              {o.name}
              {o.noData && <span className={styles.acTag}>데이터 없음</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SubwayExplorer() {
  const names = useMemo(() => Object.keys(data.stations).sort(), []);
  const options = useMemo(
    () => [
      ...names.map((n) => ({ name: n, noData: false })),
      ...Object.keys(NO_DATA)
        .filter((n) => !data.stations[n])
        .map((n) => ({ name: n, noData: true })),
    ],
    [names]
  );

  const [boarding, setBoarding] = useState("");
  const [transfers, setTransfers] = useState([]); // 환승역 입력들
  const [alighting, setAlighting] = useState("");
  const [hour, setHour] = useState(8);
  const [daytype, setDaytype] = useState("wd");

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const Lref = useRef(null);
  const layerRef = useRef(null);
  const [ready, setReady] = useState(false);

  // 입력 → {type:'data'|'nodata'|null, name}
  const resolve = (input) => {
    const t = (input || "").trim();
    if (!t) return { type: null };
    const a = t.replace(/역$/, "");
    if (data.stations[t]) return { type: "data", name: t };
    if (data.stations[a]) return { type: "data", name: a };
    if (NO_DATA[t]) return { type: "nodata", name: t };
    if (NO_DATA[a]) return { type: "nodata", name: a };
    const baseHit = names.find(
      (n) => n.split("(")[0] === t || n.split("(")[0] === a
    );
    if (baseHit) return { type: "data", name: baseHit };
    const sw = names.find((n) => n.startsWith(t) || n.startsWith(a));
    if (sw) return { type: "data", name: sw };
    const swn = Object.keys(NO_DATA).find(
      (n) => n.startsWith(t) || n.startsWith(a)
    );
    if (swn) return { type: "nodata", name: swn };
    return { type: null };
  };

  // 사용자가 지정한 경유지로 경로 구성(+검증)
  const { route, error } = useMemo(() => {
    if (!boarding.trim() || !alighting.trim())
      return { route: null, error: "" };
    const raw = [boarding, ...transfers, alighting].filter((w) => w.trim());
    const resolved = [];
    for (const w of raw) {
      const r = resolve(w);
      if (r.type === "nodata")
        return {
          route: null,
          error: `‘${w.trim()}’은(는) 타 운영사(코레일·9호선 등) 구간이라 데이터가 없습니다. 가장 가까운 데이터 보유역 ‘${NO_DATA[r.name]}’을(를) 입력해 주세요.`,
        };
      if (r.type === null)
        return {
          route: null,
          error: `‘${w.trim()}’ 역을 찾을 수 없습니다. 서울교통공사 1~8호선 역명을 확인해 주세요.`,
        };
      resolved.push(r.name);
    }
    const wps = resolved.filter((n, i) => i === 0 || n !== resolved[i - 1]);
    if (wps.length < 2) return { route: null, error: "" };
    const res = stitchRoute(data, wps);
    if (res.error === "transfer")
      return {
        route: null,
        error:
          "오류! 환승역을 정확하게 기입해주세요. 선택한 역들이 한 노선으로 이어지지 않습니다.",
      };
    if (res.error) return { route: null, error: "" };
    return { route: res, error: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boarding, transfers, alighting]);

  // 색·상위%의 단일 기준: 평일 전 시간대·전 역의 노인 비중을 한데 모은 분포.
  const baseline = useMemo(() => {
    const arr = [];
    for (const s of Object.values(data.stations)) {
      const wd = s.share?.wd;
      if (!wd) continue;
      for (const h of HOURS) {
        const v = wd[String(h)];
        if (typeof v === "number") arr.push(v);
      }
    }
    arr.sort((a, b) => a - b);
    const mean = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { sorted: arr, mean: Math.round(mean * 10) / 10 };
  }, []);

  // 표시 값은 최근 1주일 API(apiShare), 색·상위% 기준 분포는 2024 평일 풀.
  const dist = useMemo(() => {
    const sel = hourShares(data, hour, daytype, "apiShare");
    return { map: sel.map, sorted: baseline.sorted };
  }, [hour, daytype, baseline]);

  const summary = useMemo(() => {
    if (!route) return null;
    const vals = route.stations
      .map((n) => dist.map.get(n))
      .filter((v) => typeof v === "number");
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const p = percentile(dist.sorted, avg);
    const top = topPercent(p);
    return { avg, top, verdict: verdict(top) };
  }, [route, dist]);

  // 지도 초기화
  useEffect(() => {
    let map;
    (async () => {
      const L = (await import("leaflet")).default;
      Lref.current = L;
      if (!mapEl.current || mapRef.current) return;
      map = L.map(mapEl.current, { scrollWheelZoom: true }).setView(
        [37.55, 127.0],
        11
      );
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          maxZoom: 19,
        }
      ).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 지도 그리기
  useEffect(() => {
    if (!ready) return;
    const L = Lref.current;
    const layer = layerRef.current;
    layer.clearLayers();
    if (!route) return;
    const S = data.stations;
    const latlngs = route.stations.map((n) => [S[n].lat, S[n].lng]);

    L.polyline(latlngs, {
      color: "#2a2a2a",
      weight: 11,
      opacity: 0.85,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(layer);

    for (let i = 0; i < route.stations.length - 1; i++) {
      const va = dist.map.get(route.stations[i]);
      const vb = dist.map.get(route.stations[i + 1]);
      const hasData = typeof va === "number" && typeof vb === "number";
      const pa = percentile(dist.sorted, va ?? 0);
      const pb = percentile(dist.sorted, vb ?? 0);
      L.polyline([latlngs[i], latlngs[i + 1]], {
        color: hasData ? colorForP((pa + pb) / 2) : "#9aa0a6",
        weight: 6,
        opacity: 1,
        lineCap: "round",
      }).addTo(layer);
    }

    const ROLE = {
      board: { ko: "승차", color: "#1a7f37", cls: "rBoard" },
      transfer: { ko: "환승", color: "#d97706", cls: "rTransfer" },
      alight: { ko: "하차", color: "#7c3aed", cls: "rAlight" },
    };
    route.stations.forEach((n, i) => {
      const v = dist.map.get(n);
      const p = percentile(dist.sorted, v ?? 0);
      let role = null;
      if (i === 0) role = ROLE.board;
      else if (i === route.stations.length - 1) role = ROLE.alight;
      else if (route.transferStations.includes(n)) role = ROLE.transfer;

      L.circleMarker([S[n].lat, S[n].lng], {
        radius: role ? 10 : 5,
        color: role ? role.color : "#555",
        weight: role ? 4 : 1,
        fillColor: typeof v === "number" ? colorForP(p) : "#bbb",
        fillOpacity: 0.95,
      })
        .bindTooltip(
          `<b>${n}</b>${role ? ` · ${role.ko}` : ""}<br/>노인 비중 ${
            typeof v === "number" ? v.toFixed(1) + "%" : "-"
          }<br/>상위 ${typeof v === "number" ? topPercent(p) : "-"}%`,
          { direction: "top" }
        )
        .addTo(layer);

      // 승차·환승·하차역은 항상 보이는 라벨 표시
      if (role) {
        L.tooltip({
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: `roleLabel ${role.cls}`,
        })
          .setLatLng([S[n].lat, S[n].lng])
          .setContent(`${role.ko} · ${n}`)
          .addTo(layer);
      }
    });

    mapRef.current.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [ready, route, dist]);

  // 딥링크
  let kakaoUrl = "#";
  let naverUrl = "#";
  if (route) {
    const clean = (n) => n.split("(")[0];
    const oN = route.stations[0];
    const dN = route.stations[route.stations.length - 1];
    const o = data.stations[oN];
    const d = data.stations[dN];
    kakaoUrl = `https://map.kakao.com/?sName=${encodeURIComponent(
      clean(oN) + "역"
    )}&eName=${encodeURIComponent(clean(dN) + "역")}`;
    naverUrl = `https://map.naver.com/p/directions/${o.lng},${o.lat},${encodeURIComponent(
      clean(oN)
    )},,/${d.lng},${d.lat},${encodeURIComponent(clean(dN))},,/-/transit`;
  }

  // 경유지 입력 행 렌더
  const renderRow = (label, value, onChange, onRemove, placeholder, rowKey) => {
    const r = resolve(value);
    return (
      <div className={styles.wpRow} key={rowKey}>
        <span className={styles.wpLabel}>{label}</span>
        <AutoInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          options={options}
        />
        {r.type === "nodata" && (
          <button
            className={styles.suggest}
            onClick={() => onChange(NO_DATA[r.name])}
          >
            ‘{NO_DATA[r.name]}’ 선택
          </button>
        )}
        {onRemove && (
          <button className={styles.wpRemove} onClick={onRemove} title="삭제">
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <figure className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.waypoints}>
          {renderRow(
            "승차역",
            boarding,
            setBoarding,
            null,
            "역을 선택하세요",
            "boarding"
          )}

          {transfers.map((t, i) =>
            renderRow(
              `환승역 ${i + 1}`,
              t,
              (v) =>
                setTransfers((arr) => arr.map((x, j) => (j === i ? v : x))),
              () => setTransfers((arr) => arr.filter((_, j) => j !== i)),
              "환승역을 선택하세요",
              `tf-${i}`
            )
          )}

          <button
            className={styles.addTransfer}
            onClick={() => setTransfers((arr) => [...arr, ""])}
          >
            + 환승역 추가
          </button>

          {renderRow(
            "하차역",
            alighting,
            setAlighting,
            null,
            "역을 선택하세요",
            "alighting"
          )}
        </div>

        <div className={styles.options}>
          <div className={styles.field}>
            <label>시간대</label>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}시~{h + 1}시
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>요일</label>
            <div className={styles.toggle}>
              <button
                className={daytype === "wd" ? styles.on : ""}
                onClick={() => setDaytype("wd")}
              >
                평일
              </button>
              <button
                className={daytype === "we" ? styles.on : ""}
                onClick={() => setDaytype("we")}
              >
                주말
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <label>정확한 대중교통 길찾기</label>
            <div className={styles.extLinks}>
              <a
                className={`${styles.extBtn} ${styles.kakao} ${
                  route ? "" : styles.disabled
                }`}
                href={route ? kakaoUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!route}
              >
                카카오맵
              </a>
              <a
                className={`${styles.extBtn} ${styles.naver} ${
                  route ? "" : styles.disabled
                }`}
                href={route ? naverUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!route}
              >
                네이버지도
              </a>
              {!route && (
                <span className={styles.extHint}>
                  승·하차역 입력 시 활성화
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.notice}>
        ※ 이 지도는 <b>서울교통공사 1~8호선</b>만 포함합니다. 1호선 청량리
        이북(회기·외대앞 등)과 9호선·경의중앙선·분당선 등 타 운영사 구간은
        데이터가 없습니다. 직접 환승역을 지정해 경로를 만들어 주세요.
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.mapWrap}>
        <div className={styles.mapBox} ref={mapEl} />
        <div className={styles.mapBadge}>
          <span>2024년 평일 전체 평균 노인 비중 · 색상 기준</span>
          <strong>{baseline.mean}%</strong>
        </div>
      </div>

      {route && (
        <div className={styles.legend}>
          <span>노인 비중</span>
          <i style={{ background: colorForP(0.04) }} />
          <i style={{ background: colorForP(0.27) }} />
          <i style={{ background: colorForP(0.5) }} />
          <i style={{ background: colorForP(0.73) }} />
          <i style={{ background: colorForP(0.96) }} />
          <span>낮음(파랑) → 높음(빨강)</span>
        </div>
      )}

      {route && (
        <ol className={styles.itinerary}>
          {route.legs.map((leg, i) => (
            <li key={i}>
              <span
                className={styles.legLine}
                data-line={leg.line.replace("호선", "")}
              >
                {leg.line}
              </span>
              <span className={styles.legText}>
                {i === 0 ? (
                  <>
                    <b>{leg.board}</b> 승차
                  </>
                ) : (
                  <>
                    <b>{leg.board}</b> 환승
                  </>
                )}{" "}
                → {leg.alight}
                {i === route.legs.length - 1 ? " 하차" : ""}
                <span className={styles.legStops}> ({leg.stops}구간)</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {summary && (
        <div className={styles.result}>
          <div className={styles.resultTop}>
            <span className={`${styles.badge} ${styles[summary.verdict.cls]}`}>
              {summary.verdict.label}
            </span>
            <strong>
              이 구간의 {daytype === "wd" ? "평일" : "주말"} {hour}시 노인 비중은
              2024년 평일 분포 기준 <em>상위 {summary.top}%</em>
            </strong>
          </div>
          <p className={styles.resultDetail}>
            경유 {route.stops}개 역의 <b>{daytype === "wd" ? "평일" : "주말"}{" "}
            {hour}시~{hour + 1}시</b> 평균 노인 비중은 {summary.avg.toFixed(1)}%다
            (최근 1주일 API 기준). 즉 이 값은 <b>선택한 시간대만</b>의 평균이다.
            빨갈수록 노인 비중이 높은 역, 파랄수록 낮은 역이다.
          </p>
        </div>
      )}

      <figcaption className={styles.caption}>
        색은 2024년 평일 분포에서의 백분위(상위 %). ⚠ 경유역 승하차 기반
        근사치로 열차 내 실제 구성과 다를 수 있다. (값: 서울교통공사_역별승하차인원
        API 최근 1주일 · 기준: 2024 평일 · 1~8호선)
      </figcaption>
    </figure>
  );
}
