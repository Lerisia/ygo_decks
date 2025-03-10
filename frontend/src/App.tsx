import { Routes, Route } from "react-router-dom";
import './App.css'
import Navbar from "./components/Navbar";
import Recommend from './pages/Recommend'
import Changelog from './pages/Changelog'
import Decks from './pages/Decks'
import QuestionPage from "./pages/QuestionPage";
import ResultPage from "./pages/ResultPage";
import Footer from "./components/Footer";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
import Info from "./pages/Info";
import Unauthorized from "./pages/Unauthorized";
import DeckStatistics from "./pages/Statistics";
import Register from "./pages/Register";
import Login from "./pages/Login";

function App() {
  return (
    <div>
      <Navbar />
      <Routes>
          <Route path="/" element={<Recommend />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/questions" element={<QuestionPage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/info" element={<Info />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/statistics" element={<DeckStatistics />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </div>
  );
}

export default App;
