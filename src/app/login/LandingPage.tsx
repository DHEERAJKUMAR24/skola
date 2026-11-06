import { startLogin } from "@/logic/auth";
import {
  IconBrain,
  IconCloud,
  IconDeviceMobile,
  IconFreeRights,
  IconRobot,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import "./LandingPage.css";

const features = [
  {
    icon: <IconBrain size={20} stroke={1.6} />,
    title: "FSRS-6 Scheduling",
    text: "The state-of-the-art spaced repetition algorithm learns your memory curve and schedules cards at the perfect moment — so you study less and remember more.",
  },
  {
    icon: <IconCloud size={20} stroke={1.6} />,
    title: "Local-first + Sync",
    text: "Your cards live in your browser. No account needed to get started. Sign up to sync instantly across all your devices.",
  },
  {
    icon: <IconDeviceMobile size={20} stroke={1.6} />,
    title: "Works Everywhere",
    text: "A progressive web app optimised for desktop and mobile. Install it, use it offline — it's always there when you need it.",
  },
  {
    icon: <IconSparkles size={20} stroke={1.6} />,
    title: "Rich Card Types",
    text: "Basic, cloze deletion, image occlusion, reverse and double-sided cards. Full rich-text editing with formatting and pictures.",
  },
  {
    icon: <IconRobot size={20} stroke={1.6} />,
    title: "AI-Powered (MCP)",
    text: "Connect Claude or ChatGPT directly to your card collection. Create, review and analyse your decks through natural conversation.",
  },
  {
    icon: <IconFreeRights size={20} stroke={1.6} />,
    title: "Free & Open Source",
    text: "No paywalls, no subscriptions, no tracking. AGPL-3.0 — always free, forever. Fork it, self-host it, make it yours.",
  },
];

interface Props {
  onSkip: () => void;
}

export default function LandingPage({ onSkip }: Props) {
  const featureRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll-triggered reveal for feature cards
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    for (const el of featureRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <nav className="landing__nav">
        <span className="landing__nav-brand">
          <img src="/logo.svg" alt="" className="landing__nav-logo" />
          <span className="landing__nav-name">Skola++</span>
        </span>
        <div className="landing__nav-actions">
          <button
            type="button"
            className="lbtn lbtn--ghost"
            onClick={() => startLogin("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className="lbtn lbtn--primary"
            onClick={() => startLogin("signup")}
          >
            Get started free
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="landing__hero">
        <div className="landing__hero-content">
          <div className="landing__badge">
            <span className="landing__badge-dot" />
            Free &amp; Open Source · AGPL-3.0
          </div>

          <h1 className="landing__headline">
            Learn anything.
            <span className="landing__headline-accent">
              Remember everything.
            </span>
          </h1>

          <p className="landing__subheadline">
            Skola++ is a local-first spaced-repetition app powered by FSRS-6 —
            the most accurate open memory algorithm. Study smarter, not harder.
          </p>

          <div className="landing__hero-ctas">
            <button
              type="button"
              className="lbtn lbtn--primary lbtn--xl"
              onClick={() => startLogin("signup")}
            >
              Start for free
            </button>
            <button
              type="button"
              className="lbtn lbtn--outline lbtn--xl"
              onClick={() => startLogin("login")}
            >
              Sign in
            </button>
            <button type="button" className="landing__skip" onClick={onSkip}>
              Continue locally →
            </button>
          </div>
        </div>

        {/* Floating card mockups */}
        <div className="landing__hero-visual">
          <div className="landing__card-stack">
            {/* Back card */}
            <div className="landing__card-mock landing__card-mock--1">
              <div className="landing__card-label">Vocabulary</div>
              <p className="landing__card-q">What does "ephemeral" mean?</p>
              <div className="landing__card-divider" />
              <p className="landing__card-a">
                Lasting for a very short time; transitory.
              </p>
            </div>

            {/* Front card — active */}
            <div className="landing__card-mock landing__card-mock--2">
              <div className="landing__card-label">Computer Science</div>
              <p className="landing__card-q">
                What is the time complexity of binary search?
              </p>
              <div className="landing__card-divider" />
              <p className="landing__card-a">O(log n)</p>
              <div className="landing__card-rating">
                <div className="landing__rating-btn landing__rating-btn--again">
                  Again
                </div>
                <div className="landing__rating-btn landing__rating-btn--hard">
                  Hard
                </div>
                <div className="landing__rating-btn landing__rating-btn--good">
                  Good
                </div>
                <div className="landing__rating-btn landing__rating-btn--easy">
                  Easy
                </div>
              </div>
            </div>

            {/* Third card */}
            <div className="landing__card-mock landing__card-mock--3">
              <div className="landing__card-label">Biology</div>
              <p className="landing__card-q">
                What is the powerhouse of the cell?
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <div className="landing__stats">
        <div className="landing__stat">
          <span className="landing__stat-value">FSRS-6</span>
          <span className="landing__stat-label">Memory algorithm</span>
        </div>
        <div className="landing__stat">
          <span className="landing__stat-value">Local-first</span>
          <span className="landing__stat-label">No account needed</span>
        </div>
        <div className="landing__stat">
          <span className="landing__stat-value">6+</span>
          <span className="landing__stat-label">Card types</span>
        </div>
        <div className="landing__stat">
          <span className="landing__stat-value">Free</span>
          <span className="landing__stat-label">Forever, no limits</span>
        </div>
      </div>

      {/* ── Features ── */}
      <section className="landing__features">
        <div className="landing__section-header">
          <p className="landing__section-eyebrow">Why Skola++</p>
          <h2 className="landing__section-title">
            Everything you need to learn effectively
          </h2>
          <p className="landing__section-desc">
            Built for people who take learning seriously — without the bloat,
            paywalls or dark patterns.
          </p>
        </div>

        <div className="landing__features-grid">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="landing__feature-card"
              ref={(el) => {
                featureRefs.current[i] = el;
              }}
              style={{ animationDelay: `${(i % 3) * 80}ms` }}
            >
              <div className="landing__feature-icon">{f.icon}</div>
              <h3 className="landing__feature-title">{f.title}</h3>
              <p className="landing__feature-text">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="landing__cta">
        <h2 className="landing__cta-title">Your memory, supercharged.</h2>
        <p className="landing__cta-desc">
          Join thousands of learners who study smarter with FSRS-6. Free forever
          — no credit card, no catch.
        </p>
        <div className="landing__cta-actions">
          <button
            type="button"
            className="lbtn lbtn--white lbtn--lg"
            onClick={() => startLogin("signup")}
          >
            Create free account
          </button>
          <button
            type="button"
            className="lbtn lbtn--white-outline lbtn--lg"
            onClick={() => startLogin("login")}
          >
            Sign in
          </button>
        </div>
        <button type="button" className="landing__cta-skip" onClick={onSkip}>
          Continue without an account
        </button>
      </section>

      {/* ── Footer ── */}
      <footer className="landing__footer">
        <div className="landing__footer-brand">
          <img src="/logo.svg" alt="" />
          Skola++ — Free spaced repetition, forever.
        </div>
        <div className="landing__footer-links">
          <a
            href="https://github.com/h16nning/skola"
            target="_blank"
            rel="noopener noreferrer"
            className="landing__footer-link"
          >
            GitHub
          </a>
          <a href="/skills" className="landing__footer-link">
            MCP / AI
          </a>
        </div>
      </footer>
    </div>
  );
}
