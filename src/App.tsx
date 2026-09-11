import { Route, Routes } from 'react-router-dom'
import './App.css'
import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
    </Routes>
  )
}

export default App
