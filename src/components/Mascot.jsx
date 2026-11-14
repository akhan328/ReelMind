export default function Mascot({ thinking = false }) {
  return (
    <div className={thinking ? 'mascot thinking' : 'mascot'} aria-hidden="true">
      🎬
    </div>
  )
}
