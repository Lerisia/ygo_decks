import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import './App.css'
import Navbar from "./components/Navbar";
import BottomTabBar from "./components/BottomTabBar";
import TrackerBanner from "./components/TrackerBanner";
import TrackerConfirmModal from "./components/TrackerConfirmModal";
import Recommend from './pages/Recommend'
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
import Mypage from "./pages/Mypage";
import Mydecks from "./pages/Mydecks";
import Noresults from "./pages/Noresults";
import DatabasePage from "./pages/Database";
import DeckDetail from "./pages/DeckDetail";
import RecordGroups from "./pages/RecordGroups";
import RecordGroupDetail from "./pages/RecordGroupDetail";
import RecordGroupStatistics from "./pages/RecordGroupStatistics";
import DeckScanner from "./pages/DeckScanner";
import CardQuiz from "./pages/CardQuiz";
import Playground from "./pages/Playground";
import TierListMaker from "./pages/TierListMaker";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import EmailVerified from "./pages/EmailVerified";
import Tracker from "./pages/Tracker";

function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div>
      <TrackerBanner />
      <Navbar />
      <Routes>
          <Route path="/" element={<Info />} />
          <Route path="/recommend" element ={<Recommend />} />
          <Route path="/questions" element={<QuestionPage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/statistics" element={<DeckStatistics />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/mypage" element={<Mypage />} />
          <Route path="/mypage/mydecks" element={<Mydecks />} />
          <Route path="/no-results" element={<Noresults />} />
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/database/:deckId" element={<DeckDetail />} />
          <Route path="/records" element={<RecordGroups />} />
          <Route path="/record-groups/:recordGroupId" element={<RecordGroupDetail />} />
          <Route path="/record-groups/:recordGroupId/statistics" element={<RecordGroupStatistics />} />
          <Route path="/deck-scanner" element={<DeckScanner />} />
          <Route path="/card-detector" element={<DeckScanner />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/card-quiz" element={<CardQuiz />} />
          <Route path="/tier-list-maker" element={<TierListMaker />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/email-verified" element={<EmailVerified />} />
          <Route path="/tracker" element={<Tracker />} />
          <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
      <BottomTabBar />
      <TrackerConfirmModal />
      <div className="sm:hidden h-16" />
    </div>
  );
}

export default App;
