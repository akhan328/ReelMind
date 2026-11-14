import './App.css'

const ANSWERS = ['Yes', 'No', "Don't know", 'Probably', 'Probably not']

function App() {
  // Placeholder values until the game logic is added
  const questionNumber = 1
  const question = 'Is your movie animated?'

  function handleAnswer(answer) {
    // TODO: use the answer to pick the next question
    console.log('Answered:', answer)
  }

  return (
    <main className="game">
      <h1 className="title">Movie Akanator</h1>

      <div className="stage">
        <div className="genie" aria-hidden="true">
          🎬
        </div>

        <section className="question-box">
          <p className="question-number">Question {questionNumber}</p>
          <p className="question-text">{question}</p>
        </section>
      </div>

      <div className="answers">
        {ANSWERS.map((answer) => (
          <button
            key={answer}
            type="button"
            className="answer-button"
            onClick={() => handleAnswer(answer)}
          >
            {answer}
          </button>
        ))}
      </div>
    </main>
  )
}

export default App
