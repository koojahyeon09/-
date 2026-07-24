export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { start, destination, mode = 'driving' } = req.body;

  try {
    // 1. 정확한 한국 좌표 검색 (Nominatim 지오코딩 우선 사용)
    async function getCoordinates(keyword) {
      // 1차 시도: OpenStreetMap Nominatim (대한민국 한정 정확도 높음)
      try {
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(keyword + ' 대한민국')}`,
          { headers: { 'User-Agent': 'TrafficLightMapApp/1.0' } }
        );
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          if (nomData && nomData.length > 0) {
            return {
              lat: parseFloat(nomData[0].lat),
              lng: parseFloat(nomData[0].lon)
            };
          }
        }
      } catch (e) {
        console.warn("Nominatim search failed:", e);
      }

      // 2차 시도: Kakao 키워드 검색 (KAKAO_REST_KEY 설정 시)
      if (process.env.KAKAO_REST_KEY) {
        try {
          const kakaoRes = await fetch(
            `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`,
            { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` } }
          );
          if (kakaoRes.ok) {
            const kData = await kakaoRes.json();
            if (kData.documents && kData.documents.length > 0) {
              return {
                lat: parseFloat(kData.documents[0].y),
                lng: parseFloat(kData.documents[0].x)
              };
            }
          }
        } catch (e) {
          console.warn("Kakao search failed:", e);
        }
      }

      // 3차 시도: Gemini API (최신 gemini-2.5-flash)
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(`"${keyword}"의 위치를 찾을 수 없으며 GEMINI_API_KEY가 없습니다.`);
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `대한민국 "${keyword}"의 정확한 위도(lat)와 경도(lng) 좌표를 알려줘. 부연설명 없이 JSON으로만 응답: {"lat": 위도숫자, "lng": 경도숫자}`
              }]
            }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );

      const geminiData = await geminiRes.json();
      if (!geminiRes.ok || !geminiData.candidates || geminiData.candidates.length === 0) {
        throw new Error(`"${keyword}" 좌표 검색 실패`);
      }

      const text = geminiData.candidates[0].content.parts[0].text;
      return JSON.parse(text);
    }

    const startCoord = await getCoordinates(start);
    const destCoord = await getCoordinates(destination);
    const coords = { start: startCoord, dest: destCoord };

    // 2. OSRM 경로 생성
    let routeGeometry = null;
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${coords.start.lng},${coords.start.lat};${coords.dest.lng},${coords.dest.lat}?overview=full&geometries=geojson`;
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
        routeGeometry = osrmData.routes[0].geometry;
      }
    } catch (osrmErr) {
      console.warn("OSRM Error:", osrmErr);
    }

    // 3. 경찰청 신호 정보 API 수집
    let trafficLights = [];
    try {
      if (process.env.TRAFFIC_LIGHT_API_KEY) {
        const trafficApiKey = process.env.TRAFFIC_LIGHT_API_KEY;
        const trafficUrl = `https://apis.data.go.kr/B551982/rti/crsrd_map_info?serviceKey=${trafficApiKey}&type=json&pageNo=1&numOfRows=100`;
        
        const trafficRes = await fetch(trafficUrl);
        if (trafficRes.ok) {
          const tData = await trafficRes.json();
          const items = tData?.response?.body?.items?.item || tData?.body?.items || [];
          trafficLights = Array.isArray(items) ? items : [items];
        }
      }
    } catch (tErr) {
      console.warn("Traffic API Error:", tErr);
    }

    return res.status(200).json({
      success: true,
      coords,
      routeGeometry,
      trafficLights
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ success: false, error: error.message || '처리 중 에러 발생' });
  }
}
