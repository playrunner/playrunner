import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import styles from './styles.module.css';

type Message = {
  speaker: 'Codex' | 'Playrunner';
  text: string;
  attachment?: 'setup' | 'running' | 'failure' | 'history';
};

const messages: Message[] = [
  {
    speaker: 'Codex',
    text: 'Billing is added. Run our saved payment and account-access checks on staging.',
  },
  {
    speaker: 'Playrunner',
    text: 'Found both checks. They passed before this change. I’ll reuse the saved customer sign-in.',
    attachment: 'setup',
  },
  {
    speaker: 'Codex',
    text: 'Great. I’ll update the pricing page while those run.',
  },
  {
    speaker: 'Playrunner',
    text: 'Running the same Playwright tests now.',
    attachment: 'running',
  },
  {
    speaker: 'Codex',
    text: 'Pricing page updated. How are the checks looking?',
  },
  {
    speaker: 'Playrunner',
    text: 'Payments passed. But a paid customer was sent to Subscribe instead of their dashboard.',
    attachment: 'failure',
  },
  {
    speaker: 'Codex',
    text: 'I found the access-rule regression. I’ll fix it.',
  },
  {
    speaker: 'Codex',
    text: 'Access rule fixed. Rerun only the failed account-access check.',
  },
  {
    speaker: 'Playrunner',
    text: 'Passed. Paid customers reach their dashboard again. The failure and rerun are both saved.',
    attachment: 'history',
  },
  {
    speaker: 'Codex',
    text: 'Pricing is ready too. Both tasks are done.',
  },
];

const scenes = [
  { label: 'Change', lastMessage: 1 },
  { label: 'Check', lastMessage: 4 },
  { label: 'Catch', lastMessage: 6 },
  { label: 'Verify', lastMessage: 9 },
];
const CHARACTER_MS = 28;

function Attachment({ kind }: { kind: Message['attachment'] }): ReactNode {
  if (kind === 'setup') {
    return (
      <div className={styles.context}>
        <span>Staging · Saved customer sign-in</span>
        <span className={styles.passed}>Previous run · PASS</span>
      </div>
    );
  }
  if (kind === 'running') {
    return (
      <div className={styles.runAttachment}>
        <PlaywrightLogo aria-hidden="true" />
        <span>Playwright · Run started</span>
      </div>
    );
  }
  if (kind === 'failure') {
    return (
      <div className={styles.attachment}>
        <strong className={styles.failed}>FAIL · Account access</strong>
        <dl className={styles.evidence}>
          <dt>Expected</dt>
          <dd>Account dashboard</dd>
          <dt>Actual</dt>
          <dd>Redirected to Subscribe</dd>
        </dl>
        <span className={styles.report}>
          <span aria-hidden="true">↳</span> Screenshot + test report attached
        </span>
      </div>
    );
  }
  if (kind === 'history') {
    return (
      <div className={styles.attachment}>
        <strong className={styles.passed}>PASS · Account access</strong>
        <ol className={styles.history} aria-label="Account-access run history">
          <li>
            <span>Before</span>
            <b>PASS</b>
          </li>
          <li>
            <span>Billing change</span>
            <b className={styles.failed}>FAIL</b>
          </li>
          <li>
            <span>After fix</span>
            <b>PASS</b>
          </li>
        </ol>
        <span className={styles.report}>Original failed report retained</span>
      </div>
    );
  }
  return null;
}

export default function ReleasePreview(): ReactNode {
  const previewRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [{ messageIndex, characterCount }, setPlayback] = useState({
    messageIndex: 0,
    characterCount: 0,
  });
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const scene = scenes.findIndex(
    ({ lastMessage }) => messageIndex <= lastMessage,
  );
  const nextMessage = messages[messageIndex + 1];
  const currentMessage = messages[messageIndex];
  const typingMessage =
    !reducedMotion && characterCount < currentMessage.text.length;
  const activeSpeaker = typingMessage
    ? currentMessage.speaker
    : nextMessage?.speaker;

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) {
        setPlaying(false);
        setPlayback((value) => ({
          ...value,
          characterCount: messages[value.messageIndex].text.length,
        }));
      }
    };
    updateMotion();
    preference.addEventListener('change', updateMotion);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    if (previewRef.current) observer.observe(previewRef.current);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updateMotion);
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible || !pageVisible || reducedMotion) return;
    const previousCharacter = currentMessage.text[characterCount - 1];
    const characterDelay = /[.!?,]/.test(previousCharacter ?? '')
      ? 160
      : CHARACTER_MS;
    const timer = window.setTimeout(
      () => {
        setPlayback((value) =>
          typingMessage
            ? { ...value, characterCount: value.characterCount + 1 }
            : {
                messageIndex: (value.messageIndex + 1) % messages.length,
                characterCount: 0,
              },
        );
      },
      typingMessage
        ? characterDelay
        : nextMessage
          ? currentMessage.attachment
            ? 3500
            : 1800
          : 7000,
    );
    return () => window.clearTimeout(timer);
  }, [
    characterCount,
    currentMessage,
    typingMessage,
    playing,
    visible,
    pageVisible,
    reducedMotion,
    nextMessage,
  ]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    // Keep the conversation moving inside the card, without scrolling the page.
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messageIndex, characterCount]);

  return (
    <figure
      ref={previewRef}
      className={clsx(styles.preview, !playing && styles.paused)}
      aria-label="Illustrative conversation between Codex and Playrunner: saved tests catch a regression while Codex keeps working, then verify the fix"
    >
      <div className={styles.topline}>
        <div className={styles.participants}>
          <OpenAIIcon aria-hidden="true" />
          <span>Codex</span>
          <span className={styles.exchange} aria-hidden="true">
            ↔
          </span>
          <Logo aria-hidden="true" />
          <span>Playrunner</span>
        </div>
        <span className={styles.connection}>Connected</span>
      </div>
      <div className={styles.topic}>
        <span>The task</span>
        Add billing. Update the pricing page.
      </div>
      <div
        ref={transcriptRef}
        className={styles.transcript}
        role="log"
        aria-label="Codex and Playrunner conversation"
        aria-live={playing ? 'off' : 'polite'}
        tabIndex={0}
        onFocus={() => setPlaying(false)}
        onWheel={() => setPlaying(false)}
        onTouchStart={() => setPlaying(false)}
      >
        <ol className={styles.messages}>
          {messages.slice(0, messageIndex + 1).map((message, index) => (
            <li
              key={index}
              className={clsx(
                styles.message,
                message.speaker === 'Codex'
                  ? styles.agentMessage
                  : styles.runnerMessage,
              )}
            >
              <span className={styles.sender}>
                {message.speaker === 'Codex' ? (
                  <OpenAIIcon aria-hidden="true" />
                ) : (
                  <Logo aria-hidden="true" />
                )}
                {message.speaker}
              </span>
              <p aria-busy={index === messageIndex && typingMessage}>
                {index === messageIndex && typingMessage
                  ? message.text.slice(0, characterCount)
                  : message.text}
                {index === messageIndex && typingMessage && (
                  <span className={styles.cursor} aria-hidden="true" />
                )}
              </p>
              {(index < messageIndex || !typingMessage) && (
                <Attachment kind={message.attachment} />
              )}
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.activity} aria-hidden="true">
        {playing && activeSpeaker ? (
          <>
            <span className={styles.typing}>
              <i />
              <i />
              <i />
            </span>
            {typingMessage
              ? `${activeSpeaker} is typing…`
              : activeSpeaker === 'Codex'
                ? 'Codex is working…'
                : 'Playrunner is checking…'}
          </>
        ) : typingMessage || nextMessage ? (
          'Conversation paused · Scroll to read'
        ) : (
          'Checks saved. Ready for the next change.'
        )}
      </div>
      <div className={styles.controls}>
        <div
          className={styles.steps}
          role="group"
          aria-label="Conversation chapters"
        >
          {scenes.map(({ label, lastMessage }, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={scene === index}
              aria-label={`Show ${label.toLowerCase()} scene`}
              onClick={() => {
                setPlayback({
                  messageIndex: lastMessage,
                  characterCount: messages[lastMessage].text.length,
                });
                setPlaying(false);
                const transcript = transcriptRef.current;
                if (transcript) {
                  transcript.scrollTop = transcript.scrollHeight;
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!reducedMotion && (
          <button
            className={styles.playButton}
            type="button"
            aria-label={playing ? 'Pause hero demo' : 'Play hero demo'}
            onClick={() => setPlaying((value) => !value)}
          >
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          </button>
        )}
      </div>
      <figcaption>Illustrative conversation · Sample results.</figcaption>
    </figure>
  );
}
