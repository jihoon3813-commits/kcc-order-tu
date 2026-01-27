# KCC Smart Admin (Netlify Edition)

이 프로젝트는 기존 Google Apps Script(GAS) 기반 관리 시스템을 Netlify 웹사이트로 마이그레이션한 버전입니다. 데이터는 여전히 구글 시트에서 관리됩니다.

## 🚀 시작하기

### 1단계: Google Apps Script 배포 (필수)
1. `gas/Code.gs` 파일의 내용을 복사합니다.
2. 기존 구글 시트의 **확장 프로그램 > Apps Script**로 이동하여 코드를 붙여넣습니다.
3. 상단 **배포 > 새 배포**를 클릭합니다.
4. 종류를 **웹 앱**으로 선택합니다.
5. **액세스 권한이 있는 사용자**를 반드시 **모든 사용자(Anyone)**로 설정해야 합니다. (중요!)
6. 배포 후 제공되는 **웹 앱 URL**을 복사해둡니다.

### 2단계: 로컬 실행 및 빌드
```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행
npm run dev

# 프로덕션 빌드 (Netlify 배포용)
npm run build
```

### 3단계: Netlify 배포
1. `dist` 폴더를 Netlify에 드래그 앤 드롭하거나, GitHub 저장소를 연결하여 자동 배포를 설정합니다.
2. 웹사이트 접속 후, 로그인 화면에서 위에서 복사한 **GAS 웹 앱 URL**과 **Passcode**를 입력합니다.

## ✨ 주요 기능 및 디자인 개선
- **Premium UI**: Jakarta Sans 폰트와 Glassmorphism 디자인 적용
- **다이내믹 대시보드**: 실시간 데이터 시각화 및 업무 누락 방지 알림
- **보안**: 로컬 스토리지에 GAS URL과 Passcode를 안전하게 관리
- **반응형 디자인**: 모바일과 데스크탑 모두에 최적화된 레이아웃

## 📂 폴더 구조
- `index.html`: 메인 구조
- `src/main.js`: 비즈니스 로직 및 UI 인터랙션
- `src/api.js`: 구글 시트 API 연동 모듈
- `src/style.css`: 프리미엄 디자인 시스템
- `gas/Code.gs`: 구글 앱스 스크립트용 백엔드 코드
