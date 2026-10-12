package com.example.demo.adapter.in.web;

import com.example.demo.application.auth.LoginResult;
import com.example.demo.application.auth.LoginUseCase;
import com.example.demo.application.auth.LogoutUseCase;
import com.example.demo.application.auth.RefreshTokenUseCase;
import com.example.demo.application.auth.SignupUseCase;
import com.example.demo.config.SecurityConfig;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pins the CSRF contract of the auth endpoints.
 *
 * <p>Why this exists: {@code POST /api/auth/logout} is NOT in SecurityConfig's CSRF ignore list,
 * so it requires an X-XSRF-TOKEN header. The UI's logout (app-header.tsx) performs a raw fetch
 * that never sends that header, so in the browser logout receives a 403, the catch block
 * swallows it, and the httpOnly access_token cookie plus the Keycloak session survive. The user
 * only *looks* logged out. The shipped AuthControllerTest masked this by always adding
 * {@code .with(csrf())}.</p>
 *
 * <p>These tests are green: server-side behaviour is arguably correct, the bug is the UI/server
 * mismatch. They exist so whichever side gets fixed (ignore-list entry vs UI header) breaks a
 * test if the other regresses. See TEST_STRATEGY.md section 4-C.</p>
 */
@WebMvcTest(AuthController.class)
@Import({SecurityConfig.class, AuthExceptionHandler.class, ErrorTypeConstants.class,
        com.example.demo.config.TestRestClientConfig.class})
class AuthCsrfContractTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SignupUseCase signupUseCase;

    @MockitoBean
    private LoginUseCase loginUseCase;

    @MockitoBean
    private RefreshTokenUseCase refreshTokenUseCase;

    @MockitoBean
    private LogoutUseCase logoutUseCase;

    @Test
    @WithMockUser
    void should_Reject403AndSkipKeycloakInvalidation_When_LogoutSentWithoutCsrfToken() throws Exception {
        // This is exactly the request the UI's raw fetch produces: cookie present, no CSRF header.
        mockMvc.perform(post("/api/auth/logout")
                        .cookie(new Cookie("access_token", "some-jwt")))
                .andExpect(status().isForbidden());

        verifyNoInteractions(logoutUseCase);
    }

    @Test
    @WithMockUser
    void should_Return204_When_LogoutCarriesCsrfToken() throws Exception {
        mockMvc.perform(post("/api/auth/logout")
                        .with(csrf()))
                .andExpect(status().isNoContent());
    }

    /**
     * Second logout defect found while writing the test above: CookieAuthenticationFilter turns
     * any access_token cookie into a Bearer header, the resource server rejects an invalid or
     * EXPIRED token with 401, and AuthController.logout never runs. A user whose 5-minute
     * access cookie is stale therefore cannot log out or get the refresh_token cookie cleared.
     * Logout must succeed for exactly the users whose tokens are no longer valid.
     * See TEST_STRATEGY.md section 4-C.
     */
    @Test
    @Tag("defect")
    void should_ClearCookies_When_LogoutCalledWithExpiredAccessToken() throws Exception {
        mockMvc.perform(post("/api/auth/logout")
                        .with(csrf())
                        .cookie(new Cookie("access_token", "expired-or-invalid-jwt")))
                .andExpect(status().isNoContent());
    }

    @Test
    void should_PermitLoginWithoutCsrfToken_When_LoginIsOnIgnoreList() throws Exception {
        // Login is CSRF-ignored by design (no session exists yet) - pin that so it is not
        // accidentally removed from the ignore list and the whole login flow breaks.
        when(loginUseCase.login(any())).thenReturn(new LoginResult(
                "access-token", "refresh-token", UUID.randomUUID(),
                "user@example.com", "User", "CLAIMANT", OffsetDateTime.now()));

        mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email": "user@example.com", "password": "Password123!"}
                                """))
                .andExpect(status().isOk());
    }
}
