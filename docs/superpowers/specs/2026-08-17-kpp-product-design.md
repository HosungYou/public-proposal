# KPP 제안서 컴파일러 제품 설계

- 작성일: 2026-08-17
- 제품명: KPP 제안서 컴파일러
- 플러그인 ID: `korean-public-proposal`
- CLI: `kpp`
- 개발사: Enaction Labs
- 초기 버전: `0.1.0`
- 제품 성격: 한국 공공기관 연구·용역 제안서 생성 및 제출 검증

## 1. 목적

KPP는 공고, 제안요청서, 평가표, 별지, 기관별 시각 정본과 제안사의 증거를 잠그고, 한국 공공기관 연구·용역 제안서를 DOCX와 검색 가능한 PDF로 생성·검증·승격하는 로컬 우선 제품이다.

기존 `$korean-public-proposal` 스킬의 문제는 규칙이 문서로 존재하더라도 에이전트가 단계를 생략하거나 프로젝트 빌더가 정본을 우회할 수 있다는 점이다. KPP는 프롬프트 준수를 신뢰하지 않고 상태기계, 파일 해시, 결정론적 렌더러, 실제 산출물 검사와 인간 승인을 통해 이를 차단한다.

## 2. 확정된 제품 결정

1. v0.1은 RFP 입력부터 제출 패키지 생성까지 전체 자동화를 목표로 한다.
2. 제품 코어는 Node.js/TypeScript로 구현한다.
3. DOCX 생성과 저수준 OOXML 검사는 내부 Python 워커로 분리한다.
4. 고객 문서와 증거는 로컬에서 처리한다.
5. KPP 코어는 외부 AI API를 직접 호출하지 않는다.
6. 초기 AI 어댑터는 사용자가 명시적으로 호출한 Codex이다.
7. 코어는 모델 독립 인터페이스를 유지한다.
8. 출력 정본은 DOCX와 검색 가능한 PDF이다.
9. 발주처가 제공한 HWP/HWPX 별지는 원본 그대로 보존하지만 KPP가 새 HWP/HWPX를 생성하지 않는다.
10. v0.1은 macOS에서 실검증하고 Windows 호환 경계를 코드에 선반영한다. Windows 지원 표시는 실제 회귀검증 이후에만 허용한다.
11. 제출 승인은 단일 제출책임자가 수행한다.
12. 자격, 인력, 실적, 가격, 핵심 주장과 평가근거의 미확인은 제출을 차단한다.
13. 일반 설명과 향후 입력 항목은 `pending_blank` 상태의 빈 필드·빈 표로 유지할 수 있다.
14. 제품은 상용 폐쇄형으로 배포한다.
15. 공개 NPM 패키지 `@enaction-labs/kpp`는 설치기와 실행 바이너리만 제공하며 코어 소스를 포함하지 않는다.
16. Codex 플러그인은 개인 로컬 마켓플레이스에서 먼저 검증한 뒤 팀·상용 배포로 승격한다.
17. MCP는 v0.1 범위에 포함하지 않는다. 후속 버전에서 외부 시스템 통합 계층으로만 추가한다.

## 3. 저장소와 구성 요소

제품 저장소는 `/Users/hosung/work/Enaction Labs/KPP`에 독립적으로 둔다.

```text
KPP/
├── apps/
│   └── kpp-cli/
├── workers/
│   └── docx-python/
├── packages/
│   ├── core/
│   ├── schemas/
│   ├── renderers/
│   ├── audits/
│   └── issuer-pack-sdk/
├── plugins/
│   └── korean-public-proposal/
├── fixtures/
│   ├── valid/r08-reference/
│   └── known-bad/c11/
├── docs/
└── tests/
```

### 3.1 `apps/kpp-cli`

사용자와 플러그인이 호출하는 유일한 실행 진입점이다. 상태 전이, 명령 라우팅, 구조화된 JSON 출력과 사람이 읽을 수 있는 한국어 오류를 제공한다.

초기 명령은 다음과 같다.

```text
kpp doctor
kpp init
kpp status
kpp ingest
kpp plan
kpp build
kpp render
kpp audit
kpp approve
kpp release
```

### 3.2 `workers/docx-python`

Word 네이티브 표, 스타일, 번호, 섹션, 자간, 행간, 머리글·바닥글과 OOXML 무결성을 담당한다. TypeScript 코어와 버전이 명시된 JSON 요청·응답으로만 통신한다.

### 3.3 `packages/core`

상태기계, 해시, 영수증, 무효화 규칙과 release 정책의 단일 권위이다. 플러그인과 워커는 상태를 직접 변경할 수 없다.

### 3.4 `packages/schemas`

RFP, 요구사항, 평가조견표, 증거, 콘텐츠, 페이지 역할, 도식, 감사, 승인과 release 영수증의 JSON Schema 및 TypeScript 타입을 제공한다.

### 3.5 `packages/renderers`

잠긴 데이터에서 SVG와 300dpi PNG를 결정론적으로 생성한다. Gantt, RACI, 2x2 매트릭스, 흐름도, 로드맵, 복합 차트와 학술 프레임워크가 각기 별도 렌더러를 갖는다.

### 3.6 `packages/audits`

소스, 콘텐츠, 표면 계보, DOCX 기하, 도식 유형, 렌더와 release 검사를 수행한다.

### 3.7 `packages/issuer-pack-sdk`

기관별 표지, 요구 서식, 글꼴, 페이지 역할, 평가항목과 사용 경계를 별도 버전으로 관리한다. 기관별 팩은 범용 엔진과 프로젝트 사실을 포함하지 않는다.

### 3.8 Codex 플러그인

플러그인은 얇은 어댑터이다. 현재 프로젝트를 찾고 `kpp status`를 호출하며, 허용되는 다음 명령을 안내하고 Codex가 만든 구조화된 입력을 CLI에 전달한다. 플러그인은 `PASS`, 승인 또는 제출 가능 상태를 직접 만들 수 없다.

## 4. 상태기계

```text
INIT
→ SOURCE_LOCKED
→ REQUIREMENTS_LOCKED
→ EVIDENCE_LOCKED
→ DESIGN_LOCKED
→ CONTENT_APPROVED
→ BUILT
→ RENDERED
→ AUDITED
→ HUMAN_APPROVED
→ RELEASED
```

각 단계는 `receipts/`에 대상 파일 해시, 검사기 버전, 입력 영수증 해시와 결과를 기록한다. 상위 입력 또는 산출물이 변경되면 영향을 받는 하위 영수증을 무효화한다.

```text
receipts/
├── source-lock.json
├── requirements-lock.json
├── evidence-lock.json
├── design-lock.json
├── content-approval.json
├── build.json
├── render.json
├── audit.json
├── approval.json
└── release.json
```

`release`만 최종 제출 폴더를 만들 수 있다. 승인 이후 DOCX 또는 PDF 해시가 달라지면 승인과 release 상태는 즉시 무효가 된다.

## 5. 프로젝트 데이터 구조

```text
proposal-project/
├── kpp.project.yaml
├── sources/
├── requirements/
├── evidence/
├── content/
├── figures/
├── build/
├── rendered/
├── audit/
├── receipts/
└── release/
```

`kpp.project.yaml`은 기관 팩, 문서 프로파일, 출력 형식, 승인자 정책과 정확한 버전을 선언한다. 비밀키나 고객 증거 원문을 포함하지 않는다.

## 6. 생성 파이프라인

### 6.1 RFP 수집과 해석

`kpp ingest`는 공고, RFP, 평가표와 별지를 복사하고 SHA-256을 기록한다. 파서는 제출 파일, 자격, 익명성, 표지, 페이지 제한, 평가항목과 충돌을 추출한다. 자동 추출 결과는 사용자가 확인하기 전까지 `pending`이다.

### 6.2 제안서 계획

`kpp plan`은 RFP 목차와 평가항목을 기준으로 장·절, 페이지 역할, 평가조견표, 증거 슬롯과 필요한 표·도식 유형을 생성한다. 각 일반 페이지는 하나의 `page_role`과 승인된 `surface_template_id`를 가져야 한다.

### 6.3 증거 원장

모든 핵심 주장은 `claim_id`, `evidence_ids`, 출처, 상태와 목표 페이지를 가진다. AI 출력만으로 `verified` 상태가 될 수 없다.

상태는 다음과 같다.

- `verified`: 출처와 적용 범위가 검증됨
- `bounded`: 제한된 범위에서만 사용 가능
- `pending_blank`: 검토용 빈 필드 또는 빈 표
- `blocked`: 제출 전에 해소해야 하는 중요 미확인

### 6.4 콘텐츠 작성과 윤문

Codex는 승인된 계획과 증거 범위 안에서 구조화된 콘텐츠를 생성한다. 어려운 신조어, 처음 정의 없이 사용되는 용어, 영어식 병렬, 과도한 컨설팅 표현과 근거 없는 확언을 검사한다.

### 6.5 표와 도식

표는 Word 네이티브로 생성한다. 차트, Gantt, RACI, 일정, 수치, 평가표, 근거 ID와 한국어 본문은 ImageGen으로 생성하지 않는다.

Product Design/ImageGen은 검증된 국내 시각 source packet이 있고 학술적 복합 프레임워크의 토폴로지를 탐색할 때만 사용할 수 있다. 후보는 `composition_candidate`로만 저장하고 최종 문서에는 `framework.yaml`에서 다시 생성한 SVG를 넣는다.

## 7. 검증 하네스

### 7.1 Source audit

- 입력 파일 존재와 SHA-256
- 공고 버전, 기준일, 출처와 권리 상태
- 필수 서식과 제출 파일 누락

### 7.2 Content audit

- 평가항목별 답변, 근거와 페이지 연결
- 출처 없는 수치, 인력, 실적과 기관 주장
- 반복 문장, 자리표시자와 어려운 용어
- 평가조견표와 실제 페이지 일치

### 7.3 Surface lineage audit

- 모든 일반 페이지의 `page_role`
- 승인된 `surface_template_id`
- 토큰 파일 경로, 버전과 해시
- 레거시 또는 승인되지 않은 자산 사용

### 7.4 DOCX geometry audit

- Noto Sans와 Noto Serif 역할 분리
- 본문 9.3pt, 1.52행, 자간과 양쪽 정렬
- A4 여백과 콘텐츠 점유율
- DXA 표 너비, 셀 여백, 선 굵기와 정렬
- 범용 `TableGrid`와 선언되지 않은 폰트 fallback

### 7.5 Figure family audit

- 일정은 시간축, WP 행, 기간 막대와 마일스톤을 가진 Gantt인지 검사
- RACI, 차트, 매트릭스와 로드맵의 필수 구조
- 반복 박스가 의미 구조를 대체했는지 검사
- 캡션, 본문 호출, 출처와 근거 ID 일치

### 7.6 Render audit

- DOCX와 PDF 페이지 수
- 한글 글리프, 잘림, 겹침과 고아 표·그림
- 최소 글자 크기와 흑백 출력 판독성
- 페이지별 PNG 생성과 검사 상태

### 7.7 Release audit

- 모든 검사 영수증이 동일 DOCX/PDF 해시를 참조
- 제출책임자 승인 해시와 현재 파일 일치
- 중요 `blocked` 항목과 미해소 결함 차단

## 8. 회귀 전략

기존 C11 산출물을 `fixtures/known-bad/c11/`에 보존하고 다음 이유로 반드시 실패하게 한다.

- R08 표면 계보 누락
- R05 반복 박스 이미지 재사용
- 일정이 Gantt가 아님
- 본문 자간·정렬이 검증되지 않음
- 표 셀 여백과 선 굵기 불일치

R08 승인 표면과 새 결정론적 도식을 `fixtures/valid/r08-reference/`의 통과 기준으로 사용한다.

필수 회귀 시나리오는 다음과 같다.

1. C11 DOCX는 `BLOCKED`여야 한다.
2. R08 기준 픽스처는 `PASS`여야 한다.
3. 승인 이후 파일 한 글자를 변경하면 승인이 무효가 되어야 한다.
4. Gantt를 반복 박스로 교체하면 `BLOCKED`여야 한다.
5. 표 셀 여백 또는 선 굵기를 변경하면 `BLOCKED`여야 한다.
6. 필수 근거가 없는 핵심 주장은 release를 차단해야 한다.

## 9. 오류 처리

모든 CLI 명령은 사람이 읽을 수 있는 한국어 요약과 안정적인 기계 코드가 포함된 JSON을 함께 출력한다.

오류는 다음 범주를 사용한다.

- `KPP_INPUT_*`: 입력·권리·형식 문제
- `KPP_STATE_*`: 허용되지 않은 상태 전이
- `KPP_EVIDENCE_*`: 근거 누락 또는 범위 문제
- `KPP_DESIGN_*`: 정본·표면 계보 문제
- `KPP_DOCX_*`: Word 생성·OOXML 문제
- `KPP_RENDER_*`: PDF·글꼴·페이지 렌더 문제
- `KPP_RELEASE_*`: 승인·해시·제출 패키지 문제

오류는 실패한 단계, 검사 규칙, 대상 경로, 기대값, 실제값과 가능한 다음 조치를 제공한다. 자동 수정은 내용이나 기관 규칙을 추정하지 않는 안전한 기계적 변경에만 허용한다.

## 10. 운영체제 경계

v0.1은 macOS를 실지원한다. 파일 경로, 글꼴 검색, LibreOffice/Word 렌더 호출과 프로세스 관리는 운영체제 어댑터 뒤에 둔다. Windows 어댑터 인터페이스와 테스트 더블은 v0.1에 포함하지만 실제 Word/LibreOffice 회귀검증을 통과하기 전까지 Windows 지원을 광고하지 않는다.

## 11. 보안과 개인정보

1. 고객 문서, 증거와 결과물은 프로젝트 로컬 폴더에 저장한다.
2. KPP 코어는 외부 AI API를 직접 호출하지 않는다.
3. 플러그인은 사용자가 Codex에 명시적으로 제공한 범위만 전달한다.
4. 실행 로그에는 원문 본문, 개인정보, 가격과 비밀키를 기록하지 않는다.
5. 업데이트와 라이선스 기능이 추가되더라도 고객 문서 내용을 전송하지 않는다.
6. release 패키지는 익명본과 자격·정량 자료의 파일 경계를 검사한다.

## 12. 승인

v0.1은 단일 제출책임자 승인을 사용한다. `kpp approve`는 승인자 표시명, 승인 시각, DOCX/PDF 해시, audit 영수증 해시와 KPP 버전을 기록한다. 승인 파일 자체가 변경되거나 참조 대상 해시가 달라지면 승인을 무효화한다.

## 13. 플러그인과 개인 마켓플레이스

플러그인은 다음 manifest를 갖는다.

- ID: `korean-public-proposal`
- 표시명: `KPP 제안서 컴파일러`
- 개발사: `Enaction Labs`
- 초기 버전: `0.1.0`
- 카테고리: Productivity
- 설치 정책: `AVAILABLE`
- 인증 정책: `ON_INSTALL`

초기 개발용 플러그인은 `~/.agents/plugins/marketplace.json`의 개인 마켓플레이스에 등록한다. 업데이트 시 manifest cachebuster와 재설치 절차를 사용하고 새 대화에서 플러그인을 검증한다.

## 14. NPM 공개 설치기

공개 패키지 목표명은 `@enaction-labs/kpp`이다. 게시 전 조건은 다음과 같다.

1. NPM 계정이 `enaction-labs` scope에 게시 권한을 가진다.
2. CLI 인증이 `npm whoami`에 성공한다.
3. 공개 패키지는 코어 TypeScript와 Python 소스를 포함하지 않는다.
4. macOS 실행 바이너리 또는 설치된 로컬 실행기를 호출하는 얇은 JavaScript shim만 포함한다.
5. 패키지는 지원 플랫폼, 라이선스, 개인정보 경계와 제거 방법을 명시한다.
6. `npm pack --dry-run`과 깨끗한 임시 환경의 전역 설치 테스트를 통과한다.
7. `npm publish --access public` 직전에 패키지명, 버전, tarball 내용과 계정을 다시 확인한다.

`@enaction-labs/kpp`는 설치·업데이트 유통 채널이다. 제안서 상태기계의 권위는 설치된 KPP 코어에 있고 NPM shim이나 Codex 플러그인에 있지 않다.

## 15. 버전과 업데이트

다음 버전을 독립적으로 기록한다.

- 플러그인 버전
- CLI 엔진 버전
- 스키마 버전
- Python 워커 버전
- 기관 팩 버전
- 문서 템플릿 버전

프로젝트는 정확한 기관 팩과 토큰 버전을 해시로 잠근다. 업데이트는 기존 프로젝트의 정본을 자동 변경하지 않는다. 마이그레이션은 명시적 명령과 새 영수증을 통해서만 수행한다.

## 16. 설치 진단

`kpp doctor`는 다음을 확인한다.

- 지원 Node 런타임 또는 독립 실행 바이너리
- Python 워커 실행 가능 여부
- Noto CJK 글꼴
- LibreOffice 또는 승인된 PDF 렌더러
- Word 템플릿과 기관 팩
- 쓰기 가능한 프로젝트 경로
- 플러그인과 CLI 버전 호환성

누락된 의존성은 자동으로 관리자 권한을 사용해 설치하지 않는다. 필요한 조치와 안전한 설치 경로를 안내한다.

## 17. 완료 기준

v0.1은 다음 조건을 모두 충족해야 완료로 간주한다.

1. 독립 KPP 저장소와 잠긴 Node/Python 의존성이 존재한다.
2. 모든 상태 전이가 스키마와 테스트로 보호된다.
3. RFP 입력부터 DOCX/PDF release까지 대표 프로젝트가 실행된다.
4. C11 known-bad 픽스처가 기대한 규칙으로 실패한다.
5. R08 valid 픽스처가 통과한다.
6. 승인 이후 파일 변경이 release를 차단한다.
7. 개인 마켓플레이스 플러그인이 새 Codex 대화에서 `kpp status`를 호출한다.
8. `@enaction-labs/kpp` 설치기가 깨끗한 macOS 환경에서 설치·진단·제거된다.
9. NPM tarball에 코어 소스, 고객 자료, KEITI 프로젝트 사실 또는 비밀정보가 포함되지 않는다.
10. 실제 NPM 게시 후 설치 가능한 버전과 게시 계정을 기록한다.

## 18. 범위 밖

v0.1에는 다음을 포함하지 않는다.

- HWP/HWPX 신규 생성
- Windows 정식 지원 표시
- KPP의 직접 AI API 호출
- MCP 서버
- 클라우드 문서 저장
- 다중 승인 워크플로
- 자동 나라장터 제출
- 고객별 결제·라이선스 서버

이 기능은 코어 상태기계와 로컬 보안 경계를 변경하지 않는 별도 설계와 승인 후 추가한다.
