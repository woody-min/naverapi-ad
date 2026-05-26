'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password.trim()) {
      setError('아이디와 비밀번호를 모두 입력해 주세요.');
      return;
    }

    try {
      setError('');
      setLoading(true);
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password })
      });

      const result = await response.json();

      if (result.success) {
        // 로그인 성공 시 세션 쿠키가 이미 발급되었으므로 대시보드로 이동
        router.push('/');
      } else {
        setError(result.error || '로그인에 실패했습니다. 아이디 또는 비밀번호를 확인해 주세요.');
      }
    } catch (err: any) {
      setError('서버와의 통신 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* 백그라운드 프리미엄 은은한 글로우 효과 오브 */}
      <div className="glow-orb orb-cyan"></div>
      <div className="glow-orb orb-purple"></div>

      <div className="login-card glass-panel">
        <div className="login-header">
          <div className="login-logo">N</div>
          <h1 className="login-title">Premium Adboard</h1>
          <p className="login-subtitle">네이버 검색광고 분석 대시보드 로그인</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          {error && <div className="error-alert">{error}</div>}

          <div className="input-group">
            <label className="input-label">아이디</label>
            <input
              type="text"
              className="login-input"
              placeholder="아이디를 입력하세요 (예: taemin)"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="input-group">
            <label className="input-label">비밀번호</label>
            <input
              type="password"
              className="login-input"
              placeholder="••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? (
              <div className="loading-spinner"></div>
            ) : (
              <span>로그인 (Sign In)</span>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p className="footer-notice">※ 본 시스템은 인가된 사용자 전용 보안 대시보드입니다.</p>
        </div>
      </div>

      <style jsx global>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: #0b0f19;
          position: relative;
          overflow: hidden;
          padding: 24px;
        }

        /* 은은한 배경 오라 효과 */
        .glow-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.15;
          z-index: 1;
          pointer-events: none;
        }

        .orb-cyan {
          width: 400px;
          height: 400px;
          background: #06b6d4;
          top: 15%;
          left: 15%;
          animation: float-slow 15s ease-in-out infinite;
        }

        .orb-purple {
          width: 500px;
          height: 500px;
          background: #6366f1;
          bottom: 15%;
          right: 15%;
          animation: float-slow-reverse 18s ease-in-out infinite;
        }

        @keyframes float-slow {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-30px) scale(1.05); }
        }

        @keyframes float-slow-reverse {
          0%, 100% { transform: translateY(0) scale(1.05); }
          50% { transform: translateY(30px) scale(1); }
        }

        /* 로그인 카드 디자인 */
        .login-card {
          width: 100%;
          max-width: 450px;
          padding: 48px 40px;
          background: rgba(30, 41, 59, 0.45);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
          z-index: 10;
          transition: var(--transition-smooth);
        }

        .login-card:hover {
          border-color: rgba(6, 182, 212, 0.2);
          box-shadow: 0 20px 50px rgba(6, 182, 212, 0.05);
        }

        /* 헤더 섹션 */
        .login-header {
          text-align: center;
          margin-bottom: 36px;
        }

        .login-logo {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 1.5rem;
          color: white;
          margin-bottom: 20px;
          box-shadow: 0 0 20px rgba(6, 182, 212, 0.3);
        }

        .login-title {
          font-size: 1.6rem;
          font-weight: 800;
          letter-spacing: -0.025em;
          background: linear-gradient(to right, #ffffff, #e2e8f0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }

        .login-subtitle {
          font-size: 0.8rem;
          color: #94a3b8;
          font-weight: 500;
        }

        /* 폼 요소 */
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .error-alert {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: #f43f5e;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 0.78rem;
          font-weight: 600;
          line-height: 1.4;
          text-align: center;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .input-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .login-input {
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 14px 18px;
          border-radius: 12px;
          color: #f8fafc;
          font-size: 0.9rem;
          outline: none;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .login-input::placeholder {
          color: #475569;
        }

        .login-input:focus {
          border-color: #06b6d4;
          box-shadow: 0 0 15px rgba(6, 182, 212, 0.15);
          background: rgba(15, 23, 42, 0.7);
        }

        /* 로그인 버튼 */
        .btn-login {
          margin-top: 10px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          border: none;
          color: white;
          padding: 15px 24px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 20px rgba(6, 182, 212, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-login:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(6, 182, 212, 0.4);
        }

        .btn-login:disabled {
          background: #1e293b;
          color: #475569;
          box-shadow: none;
          cursor: not-allowed;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* 하단 푸터 */
        .login-footer {
          margin-top: 36px;
          text-align: center;
        }

        .footer-notice {
          font-size: 0.7rem;
          color: #475569;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
