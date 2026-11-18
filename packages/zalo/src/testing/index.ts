export {
	assertSyntheticZaloEnvironment,
	INTEGRATION_SECRET_NAME_PATTERN,
	SYNTHETIC_SECRET_PREFIX,
	SyntheticEnvironmentError,
	ZALO_SYNTHETIC_ENVIRONMENT_KEYS,
	type ZaloIntegrationGate,
	zaloIntegrationGate,
} from "./environment.js";
export {
	createFakeBackend,
	type FakeBackend,
	type FakeBackendCall,
	type FakeBrandApp,
	type FakeIdentity,
	type FakeMember,
} from "./fake-backend.js";
export {
	createMockZalo,
	MOCK_ACCESS_TOKEN_LIFETIME_MS,
	MOCK_PHONE_TOKEN_LIFETIME_MS,
	MOCK_ZALO_ERRORS,
	type MockZalo,
	type MockZaloFault,
	type MockZaloOptions,
	type MockZaloRequest,
	type MockZaloServer,
	type MockZaloUser,
	startMockZalo,
} from "./mock-zalo.js";
