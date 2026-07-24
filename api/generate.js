export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination } = req.body;

  try {
    const kakaoKey = process.env.KAKAO_REST_KEY;
    if (!kakaoKey) {
      throw new Error("Vercel에 KAKAO_REST_KEY 환경변수가 설정되지 않았습니다.");
    }

    // 1. 카카오 위치 검색 (좌표 변환)
    async function getKakaoCoord(keyword) {
      const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`, {
        headers: { Authorization: `KakaoAK ${kakaoKey}` }
      });
      const data = await res.json();
      if (data.documents && data.documents.length > 0) {
        return { lat: parseFloat(data.documents[0].y), lng: parseFloat(data.documents[0].x) };
      }
      throw new Error(`"${keyword}"의 위치를 찾을 수 없습니다.`);
    }

    const startCoord = await getKakaoCoord(start);
    const destCoord = await getKakaoCoord(destination);

    // 2. 카카오 내비 API (실제 도로망 길찾기)
    let routeGeometry = null;
    const naviUrl = `https://apis-navi.kakaomobility.com/v1/directions?origin=${startCoord.lng},${startCoord.lat}&destination=${destCoord.lng},${destCoord.lat}&priority=RECOMMEND`;
    
    const naviRes = await fetch(naviUrl, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` }
    });
    const naviData = await naviRes.json();

    if (naviData.routes && naviData.routes.length > 0) {
      // 카카오 내비 응답을 지도에 그릴 수 있는 선(GeoJSON)으로 변환
      const lineCoords = [];
      naviData.routes[0].sections.forEach(section => {
        section.roads.forEach(road => {
          for (let i = 0; i < road.vertexes.length; i += 2) {
            lineCoords.push([road.vertexes[i], road.vertexes[i+1]]); // [경도, 위도]
          }
        });
      });
      routeGeometry = { type: "LineString", coordinates: lineCoords };
    } else {
      throw new Error("길찾기 경로를 찾을 수 없습니다.");
    }

    // 3. 경찰청 신호등 교차로 정보
    let trafficLights = [];
    let trafficError = null;
    const trafficApiKey = process.env.TRAFFIC_LIGHT_API_KEY;
    
    if (trafficApiKey) {
      try {
        const trafficUrl = `https://apis.data.go.kr/B551982/rti/crsrd_map_info?serviceKey=${trafficApiKey}&type=json&pageNo=1&numOfRows=100`;
        const trafficRes = await fetch(trafficUrl);
        const tData = await trafficRes.json();
        
        const items = tData?.response?.body?.items?.item || tData?.body?.items || [];
        const itemsArray = Array.isArray(items) ? items : (items ? [items] : []);
        
        trafficLights = itemsArray.map(item => ({
          name: item.crsrdNm || '교차로',
          lat: parseFloat(item.crsrdY),
          lng: parseFloat(item.crsrdX)
        })).filter(item => item.lat > 0 && item.lng > 0);

      } catch (e) {
        trafficError = "경찰청 API 통신/인증 에러 (Encoding 키를 확인하세요)";
      }
    } else {
      trafficError = "TRAFFIC_LIGHT_API_KEY 환경변수가 없습니다.";
    }

    return res.status(200).json({
      success: true,
      coords: { start: startCoord, dest: destCoord },
      routeGeometry,
      trafficLights,
      trafficError // 프론트엔드에서 에러 원인을 보여주기 위해 추가
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
