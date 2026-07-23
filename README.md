# 🚦 신호등 지도 AI (Traffic Light Map AI)

Vercel 서버리스 함수와 Gemini 2.5 Flash API를 활용하여 신호 대기 시간을 고려한 최적 경로를 안내하는 웹 애플리케이션입니다.

## 📁 프로젝트 구조

```text
traffic-light-map/
├── index.html        # 프론트엔드 UI
└── api/
    └── generate.js   # Vercel 서버리스 API (Gemini API 호출)
```

## 🚀 Vercel 배포 방법

1. 이 프로젝트 파일들을 GitHub 리포지토리에 푸시하거나 Vercel CLI로 업로드합니다.
2. Vercel 대시보드 프로젝트 설정(**Settings** > **Environment Variables**)에서 환경변수를 추가합니다:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: `발급받은_Gemini_API_키`
3. 배포(Redeploy) 후 완료됩니다!
