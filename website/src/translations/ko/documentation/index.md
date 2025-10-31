# 문서

Deepkit은 MIT 라이선스 하에 자유롭게 제공되는 오픈 소스 TypeScript 프레임워크로, 확장 가능하고 유지보수가 쉬운 백엔드 애플리케이션을 구축하도록 설계되었습니다. 브라우저와 Node.js에서 동작하도록 설계되었지만, 적합한 어느 JavaScript 환경에서도 실행될 수 있습니다.

여기에서 Deepkit의 다양한 구성 요소에 대한 챕터와 모든 패키지의 API 레퍼런스를 확인할 수 있습니다.

도움이 필요하시면 언제든지 우리의 [Discord 서버](https://discord.com/invite/PtfVf7B8UU)에 참여하시거나 [GitHub](https://github.com/marcj/d7)에서 이슈를 열어주세요.

## 챕터


- [앱](/documentation/app.md) - 명령줄 인터페이스를 기반으로 Deepkit으로 첫 애플리케이션을 작성합니다.
- [프레임워크](/documentation/framework.md) - 애플리케이션에 (HTTP/RPC) 서버, API 문서, 디버거, 통합 테스트 등을 추가합니다.
- [런타임 타입](/documentation/runtime-types.md) - TypeScript 런타임 타입과 데이터 검증 및 변환에 대해 학습합니다.
- [의존성 주입](/documentation/dependency-injection.md) - 의존성 주입 컨테이너, 제어의 역전, 의존성 역전.
- [파일시스템](/documentation/filesystem.md) - 로컬 및 원격 파일 시스템을 통합된 방식으로 다루기 위한 파일시스템 추상화.
- [브로커](/documentation/broker.md) - 분산 L2 캐시, pub/sub, 큐, 중앙 원자적 락, 키-값 저장소와 함께 작업하기 위한 메시지 브로커 추상화.
- [HTTP](/documentation/http.md) - 타입 안전한 엔드포인트를 구축하기 위한 HTTP 서버 추상화.
- [RPC](/documentation/rpc.md) - 프론트엔드를 백엔드와 연결하거나 여러 백엔드 서비스를 연결하기 위한 원격 프로시저 호출(RPC) 추상화.
- [ORM](/documentation/orm.md) - 데이터를 타입 안전한 방식으로 저장하고 질의하기 위한 ORM 및 DBAL.
- [데스크톱 UI](/documentation/desktop-ui/getting-started) - Deepkit의 Angular 기반 UI 프레임워크로 GUI 애플리케이션을 빌드합니다.

## API 레퍼런스

다음은 모든 Deepkit 패키지와 그들의 API 문서 링크의 전체 목록입니다.

### 구성

- [@d7/app](/documentation/package/app.md)
- [@d7/framework](/documentation/package/framework.md)
- [@d7/http](/documentation/package/http.md)
- [@d7/angular-ssr](/documentation/package/angular-ssr.md)

### 인프라

- [@d7/rpc](/documentation/package/rpc.md)
- [@d7/rpc-tcp](/documentation/package/rpc-tcp.md)
- [@d7/broker](/documentation/package/broker.md)
- [@d7/broker-redis](/documentation/package/broker-redis.md)

### 파일시스템

- [@d7/filesystem](/documentation/package/filesystem.md)
- [@d7/filesystem-ftp](/documentation/package/filesystem-ftp.md)
- [@d7/filesystem-sftp](/documentation/package/filesystem-sftp.md)
- [@d7/filesystem-s3](/documentation/package/filesystem-s3.md)
- [@d7/filesystem-google](/documentation/package/filesystem-google.md)
- [@d7/filesystem-database](/documentation/package/filesystem-database.md)

### 데이터베이스

- [@d7/orm](/documentation/package/orm.md)
- [@d7/mysql](/documentation/package/mysql.md)
- [@d7/postgres](/documentation/package/postgres.md)
- [@d7/sqlite](/documentation/package/sqlite.md)
- [@d7/mongodb](/documentation/package/mongodb.md)

### 기초

- [@d7/type](/documentation/package/type.md)
- [@d7/event](/documentation/package/event.md)
- [@d7/injector](/documentation/package/injector.md)
- [@d7/template](/documentation/package/template.md)
- [@d7/logger](/documentation/package/logger.md)
- [@d7/workflow](/documentation/package/workflow.md)
- [@d7/stopwatch](/documentation/package/stopwatch.md)

### 도구

- [@d7/api-console](/documentation/package/api-console.md)
- [@d7/devtool](/documentation/package/devtool.md)
- [@d7/desktop-ui](/documentation/package/desktop-ui.md)
- [@d7/orm-browser](/documentation/package/orm-browser.md)
- [@d7/bench](/documentation/package/bench.md)
- [@d7/run](/documentation/package/run.md)

### 핵심

- [@d7/bson](/documentation/package/bson.md)
- [@d7/core](/documentation/package/core.md)
- [@d7/topsort](/documentation/package/topsort.md)

### 런타임

- [@d7/vite](/documentation/package/vite.md)
- [@d7/bun](/documentation/package/bun.md)
- [@d7/type-compiler](/documentation/package/type-compiler.md)