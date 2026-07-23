export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Vercel 환경변수에서 GEMINI_API_KEY 로드
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 설정에서 키를 추가해 주세요.' 
    });
  }

  const { start, destination, mode } = req.body;

  if (!start || !destination) {
    return res.status(400).json({ error: '출발지와 목적지를 모두 입력해 주세요.' });
  }

  const prompt = `
당신은 신호등 대기시간 및 도로 흐름을 분석해 최적의 경로를 안내하는 "신호등 지도 AI"입니다.

[요청 정보]
- 출발지: ${start}
- 목적지: ${destination}
- 이동 수단: ${mode || '도보 및 대중교통'}

위 정보를 기반으로 신호 대기 시간을 최소화하는 최적 경로와 신호등 관련 이동 팁을 분석해 주세요.
반드시 아래 예시와 동일한 **JSON 형식**으로만 응답해 주세요:

{
  "summary": "신호 대기 시간을 최소화한 최적 경로 요약",
  "estimatedTime": "약 15분",
  "trafficLightCount": "약 4개",
  "steps": [
    "1. 출발지에서 XX 방향으로 200m 이동 (첫 번째 신호등은 직진 신호 주기 긴 편)",
    "2. XX 사거리에서 우회전 후 보행자 횡단보도 이용",
    "3. XX 건물 앞에서 신호 대기 없이 대각선 횡단보도 이용"
  ],
  "aiTip": "이 구간은 오후 6시~7시 사이에 신호 주기가 짧아지므로 건널목 대기 시 XX 측면 인도를 추천합니다."
}
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API 호출 중 오류가 발생했습니다.');
    }

    // Gemini의 JSON 응답 파싱
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const routeData = JSON.parse(candidateText);

    return res.status(200).json(routeData);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' });
  }
}
