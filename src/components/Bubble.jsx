import Mascot from './Mascot.jsx'

// The mascot with a speech bubble under it
export default function Bubble({ label, thinking = false, children }) {
  return (
    <div className="stage">
      <Mascot thinking={thinking} />
      <section className="question-box">
        {label && <p className="question-number">{label}</p>}
        <div className="question-text">{children}</div>
      </section>
    </div>
  )
}
