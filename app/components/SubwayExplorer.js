"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import data from "../_data/subway.json";
import { buildGraph, findRoutes } from "../lib/subwayRouting";
import {
  hourShares,
  percentile,
  topPercent,
  colorForP,
} from "../lib/subwayStats";
import styles from "./SubwayExplorer.module.css";

const HOURS = data.meta.hours || Array.from({ length: 18 }, (_, i) => i + 6);

function verdict(top) {
  if (top <= 15) return { label: "유독 많음", cls: "vHigh" };
  if (top <= 40) return { label: "다소 많음", cls: "vMidHigh" };
  if (top <= 60) return { label: "평범", cls: "vMid" };
  if (top <= 85) return { label: "다소 적음", cls: "vMidLow" };
  return { label: "적음", cls: "vLow" };
}

export default function SubwayExplorer() {
  const graph = useMemo(() => buildGraph(data), []);
  const names = useMemo(() => Object.keys(data.stations).sort(), []);

  const [origin, setOrigin] = useState("제기동");
  const [dest, setDest] = useState("강남");
  const [hour, setHour] = useState(8);
  const [daytype, setDaytype] = useState("wd");
  const [routes, setRoutes] = useState([]);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState("");

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const Lref = useRef(null);
  const layerRef = useRef(null);
  const [ready, setReady] = useState(false);

  // 지도 초기화 (클라이언트 전용)
  useEffect(() => {
    let map;
    (async () => {
      const L = (await import("leaflet")).default;
      Lref.current = L;
      if (!mapEl.current || mapRef.current) return;
      map = L.map(mapEl.current, { scrollWheelZoom: false }).setView(
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

  // 입력 역명 → 데이터의 정식 역명 (역 접미사·부역명·부분일치 보정)
  const resolveName = (input) => {
    const t = (input || "").trim();
    if (!t) return null;
    if (data.stations[t]) return t;
    const a = t.replace(/역$/, "");
    if (data.stations[a]) return a;
    return (
      names.find((n) => n.split("(")[0] === t || n.split("(")[0] === a) ||
      names.find((n) => n.startsWith(t) || n.startsWith(a)) ||
      null
    );
  };

  // 경로 계산
  const compute = () => {
    setError("");
    const o = resolveName(origin);
    const d = resolveName(dest);
    const missing = [!o && origin, !d && dest].filter(Boolean);
    if (missing.length) {
      setError(
        `‘${missing.join(", ")}’ 역을 찾을 수 없습니다. 이 지도는 서울교통공사 1~8호선 운영 역만 포함합니다(회기·외대앞 등 코레일 운영 구간 제외).`
      );
      setRoutes([]);
      return;
    }
    if (o !== origin) setOrigin(o);
    if (d !== dest) setDest(d);
    if (o === d) {
      setError("출발역과 도착역이 같습니다.");
      setRoutes([]);
      return;
    }
    const r = findRoutes(graph, o, d, 3);
    if (!r.length) {
      setError("경로를 찾지 못했습니다.");
      setRoutes([]);
      return;
    }
    setRoutes(r);
    setSel(0);
  };

  // 최초 1회 자동 계산
  useEffect(() => {
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 시간대 분포
  const dist = useMemo(
    () => hourShares(data, hour, daytype),
    [hour, daytype]
  );

  // 선택 경로 요약
  const summary = useMemo(() => {
    const route = routes[sel];
    if (!route) return null;
    const vals = route.stations
      .map((n) => dist.map.get(n))
      .filter((v) => typeof v === "number");
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const p = percentile(dist.sorted, avg);
    const top = topPercent(p);
    return { avg, p, top, verdict: verdict(top) };
  }, [routes, sel, dist]);

  // 지도 그리기
  useEffect(() => {
    if (!ready || !routes[sel]) return;
    const L = Lref.current;
    const layer = layerRef.current;
    layer.clearLayers();
    const route = routes[sel];
    const S = data.stations;
    const latlngs = route.stations.map((n) => [S[n].lat, S[n].lng]);

    // 어두운 외곽선(casing) — 색과 무관하게 경로가 항상 보이도록
    L.polyline(latlngs, {
      color: "#2a2a2a",
      weight: 11,
      opacity: 0.85,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(layer);

    // 구간(역-역)별 그라데이션 선 (외곽선 위에 올림)
    for (let i = 0; i < route.stations.length - 1; i++) {
      const a = route.stations[i];
      const b = route.stations[i + 1];
      const va = dist.map.get(a);
      const vb = dist.map.get(b);
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

    // 역 마커
    route.stations.forEach((n, i) => {
      const v = dist.map.get(n);
      const p = percentile(dist.sorted, v ?? 0);
      const isEnd = i === 0 || i === route.stations.length - 1;
      L.circleMarker([S[n].lat, S[n].lng], {
        radius: isEnd ? 8 : 5,
        color: "#222",
        weight: isEnd ? 2 : 1,
        fillColor: typeof v === "number" ? colorForP(p) : "#bbb",
        fillOpacity: 0.95,
      })
        .bindTooltip(
          `<b>${n}</b><br/>노인 비중 ${
            typeof v === "number" ? v.toFixed(1) + "%" : "-"
          }<br/>상위 ${typeof v === "number" ? topPercent(p) : "-"}%`,
          { direction: "top" }
        )
        .addTo(layer);
    });

    mapRef.current.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [ready, routes, sel, dist]);

  return (
    <figure className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.field}>
          <label>승차역</label>
          <input
            list="stnlist"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label>하차역</label>
          <input
            list="stnlist"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
          />
        </div>
        <datalist id="stnlist">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
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
        <button className={styles.go} onClick={compute}>
          경로 보기
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {routes.length > 0 && (
        <div className={styles.routes}>
          {routes.map((r, i) => (
            <button
              key={i}
              className={`${styles.routeChip} ${
                i === sel ? styles.routeOn : ""
              }`}
              onClick={() => setSel(i)}
            >
              <b>경로 {i + 1}</b> · {r.stops}역 · 환승 {r.transfers}
              {r.transferStations.length > 0 && (
                <span className={styles.chipTransfer}>
                  {" "}
                  ({r.transferStations.join(", ")})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {routes[sel] && (
        <ol className={styles.itinerary}>
          {routes[sel].legs.map((leg, i) => (
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
                {i === routes[sel].legs.length - 1 ? " 하차" : ""}
                <span className={styles.legStops}> ({leg.stops}구간)</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.mapBox} ref={mapEl} />

      <div className={styles.legend}>
        <span>노인 비중</span>
        <i style={{ background: colorForP(0.04) }} />
        <i style={{ background: colorForP(0.27) }} />
        <i style={{ background: colorForP(0.5) }} />
        <i style={{ background: colorForP(0.73) }} />
        <i style={{ background: colorForP(0.96) }} />
        <span>낮음(파랑) → 높음(빨강)</span>
      </div>

      {summary && (
        <div className={styles.result}>
          <div className={styles.resultTop}>
            <span className={`${styles.badge} ${styles[summary.verdict.cls]}`}>
              {summary.verdict.label}
            </span>
            <strong>
              이 구간 노인 비중은 {daytype === "wd" ? "평일" : "주말"} {hour}시
              기준 <em>상위 {summary.top}%</em>
            </strong>
          </div>
          <p className={styles.resultDetail}>
            경유 {routes[sel].stops}개 역의 평균 노인 비중 {summary.avg.toFixed(1)}
            % (전체 역 평균{" "}
            {data.baseline2024?.[daytype]?.[String(hour)]?.mean ?? "-"}%). 색이
            빨갈수록 그 시간대에 노인 비중이 높은(상위) 역, 파랄수록 낮은 역이다.
          </p>
        </div>
      )}

      <figcaption className={styles.caption}>
        승·하차역과 시간대를 입력하면 추천 경로(최대 3개)와 경유역의 노인 비중을
        지도에 표시한다. 색은 같은 시간대 전체 역 분포에서의 백분위(상위 %)를
        뜻한다. ⚠ 경유역 승하차 기반 근사치이며, 열차 내 실제 승객 구성과는 다를
        수 있다. (자료: 서울교통공사 2024년 역별·시간대별 노인·전체 승하차,
        1~8호선)
      </figcaption>
    </figure>
  );
}
