import { Button } from "@/components/ui/Button";
import { startLogin } from "@/logic/auth";
import "./AuthGate.css";

/** Full-screen prompt shown before the app when nobody is signed in. */
export default function AuthGate({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        <div className="auth-gate__brand">
          <img
            src="/logo.svg"
            alt=""
            width={56}
            height={56}
            className="auth-gate__logo"
          />
          <h1 className="auth-gate__name">Skola++</h1>
          <p className="auth-gate__tagline">
            Sign in to sync your cards across devices.
          </p>
        </div>

        <div className="auth-gate__actions">
          <Button variant="primary" onClick={() => startLogin("login")}>
            Sign in
          </Button>
          <Button variant="default" onClick={() => startLogin("signup")}>
            Create account
          </Button>
        </div>

        <div className="auth-gate__skip">
          <button
            type="button"
            className="auth-gate__skip-link"
            onClick={onSkip}
          >
            Continue without signing in
          </button>
        </div>
      </div>
    </div>
  );
}
