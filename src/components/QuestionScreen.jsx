import Bubble from './Bubble.jsx'

// Button order on screen, and the value each answer feeds the algorithm
const ANSWERS = [
  { label: 'Yes', value: 1 },
  { label: 'No', value: -1 },
  { label: "Don't know", value: 0 },
  { label: 'Probably', value: 0.5 },
  { label: 'Probably not', value: -0.5 },
]

export default function QuestionScreen({
  number,
  max,
  text,
  busy,
  onAnswer,
  canStop,
  onStop,
  canGoBack,
  onBack,
}) {
  return (
    <>
      <Bubble label={`Question ${number} of up to ${max}`} thinking={busy}>
        {text}
      </Bubble>

      <div className="answers">
        {ANSWERS.map((answer) => (
          <button
            key={answer.label}
            type="button"
            className="answer-button"
            disabled={busy}
            onClick={() => onAnswer(answer.value)}
          >
            {answer.label}
          </button>
        ))}
      </div>

      {(canGoBack || canStop) && (
        <div className="screen-links">
          {canGoBack && (
            <button type="button" className="text-button" disabled={busy} onClick={onBack}>
              ← Back
            </button>
          )}
          {canStop && (
            <button type="button" className="text-button" disabled={busy} onClick={onStop}>
              Stop and show my pick
            </button>
          )}
        </div>
      )}
    </>
  )
}
