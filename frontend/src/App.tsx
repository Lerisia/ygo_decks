import { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import './App.css'
import Navbar from "./components/Navbar";
import BottomTabBar from "./components/BottomTabBar";
import { useDrawingMode } from "./lib/drawingMode";
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
import Register from "./pages/Register";
import Login from "./pages/Login";
import Mypage from "./pages/Mypage";
import PointsHistory from "./pages/PointsHistory";
import AdminPointsGrant from "./pages/AdminPointsGrant";
import AdminAnalytics from "./pages/AdminAnalytics";
import { usePageTracking } from "./hooks/usePageTracking";
import { useScrollRestoration } from "./hooks/useScrollRestoration";
import AdminIndex from "./pages/AdminIndex";
import Mydecks from "./pages/Mydecks";
import Noresults from "./pages/Noresults";
import DatabasePage from "./pages/Database";
import DeckDetail from "./pages/DeckDetail";
import RecordGroups from "./pages/RecordGroups";
import RecordGroupDetail from "./pages/RecordGroupDetail";
import RecordGroupStatistics from "./pages/RecordGroupStatistics";
import Tournaments from "./pages/Tournaments";
import CreateTournament from "./pages/CreateTournament";
import TournamentDetailPage from "./pages/TournamentDetail";
import DeckScanner from "./pages/DeckScanner";
import CardQuiz from "./pages/CardQuiz";
import Playground from "./pages/Playground";
import AllMenu from "./pages/AllMenu";
import Tools from "./pages/Tools";
import Solo from "./pages/Solo";
import SoloDuchmind from "./pages/SoloDuchmind";
import SoloDraw from "./pages/SoloDraw";
import SoloDrawingDetail from "./pages/SoloDrawingDetail";
import SoloTwenty from "./pages/SoloTwenty";
import SkillNames from "./pages/SkillNames";
import TierListMaker from "./pages/TierListMaker";
import Multiplayer from "./pages/Multiplayer";
import MultiplayerRoom from "./pages/MultiplayerRoom";
import AdminCardIcons from "./pages/AdminCardIcons";
import AdminBorders from "./pages/AdminBorders";
import AdminEffectTags from "./pages/AdminEffectTags";
import AdminDuchMindWords from "./pages/AdminDuchMindWords";
import DuchMindWordPacks from "./pages/DuchMindWordPacks";
import DuchMindWordPackDetail from "./pages/DuchMindWordPackDetail";
import MyAvatar from "./pages/MyAvatar";
import IconShop from "./pages/IconShop";
import Changelog from "./pages/Changelog";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import EmailVerified from "./pages/EmailVerified";
import Tracker from "./pages/Tracker";
import NoticePopup from "./components/NoticePopup";

function App() {
  const { pathname } = useLocation();
  useScrollRestoration();
  usePageTracking();
  const inMultiplayerRoom = pathname.startsWith("/multiplayer/rooms/");
  // The deck database stays mounted (just hidden) while a deck page is open, so Back shows the same list with
  // its pictures already drawn instead of rebuilding it (엘리스 2026-10-02).
  const onDeckList = pathname === "/database";
  const inDeckBook = onDeckList || pathname.startsWith("/database/");
  // Only a list that was already on screen is kept: one first built inside the hidden box makes the browser fetch
  // every thumbnail at once (a deck page opened from Google pulled all 221, 2026-10-06).
  const [listOpened, setListOpened] = useState(onDeckList);
  if (onDeckList && !listOpened) setListOpened(true);
  if (!inDeckBook && listOpened) setListOpened(false);
  const keepDeckList = onDeckList || (listOpened && inDeckBook);
  // While a player is actively drawing (DuchMind turn / Solo draw page),
  // all site chrome is hidden so nothing overlaps the canvas.
  const drawingMode = useDrawingMode();

  return (
    <div>
      {!drawingMode && <TrackerBanner />}
      {!drawingMode && (
        <div className="site-header-bleed">
          <Navbar />
        </div>
      )}
      <NoticePopup disabled={drawingMode || inMultiplayerRoom} />
      {keepDeckList && (
        <div hidden={!onDeckList}>
          <DatabasePage />
        </div>
      )}
      <Routes>
          <Route path="/" element={<Info />} />
          <Route path="/recommend" element ={<Recommend />} />
          <Route path="/questions" element={<QuestionPage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          {/* The test's answer statistics were retired (2026-10); old links land on the test. */}
          <Route path="/statistics" element={<Navigate to="/recommend" replace />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/mypage" element={<Mypage />} />
          <Route path="/mypage/points" element={<PointsHistory />} />
          <Route path="/mypage/mydecks" element={<Mydecks />} />
          <Route path="/no-results" element={<Noresults />} />
          <Route path="/database" element={null} />
          <Route path="/database/:deckId" element={<DeckDetail />} />
          <Route path="/records" element={<RecordGroups />} />
          <Route path="/record-groups/statistics" element={<RecordGroupStatistics />} />
          {/* 대회 (내부 테스트 중 — 네비게이션 미노출) */}
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/create" element={<CreateTournament />} />
          <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
          <Route path="/record-groups/:recordGroupId" element={<RecordGroupDetail />} />
          <Route path="/record-groups/:recordGroupId/statistics" element={<RecordGroupStatistics />} />
          <Route path="/deck-scanner" element={<DeckScanner />} />
          <Route path="/card-detector" element={<DeckScanner />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/all" element={<AllMenu />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/solo" element={<Solo />} />
          <Route path="/solo-duchmind" element={<SoloDuchmind />} />
          <Route path="/solo-duchmind/draw" element={<SoloDraw />} />
          <Route path="/solo-duchmind/:id" element={<SoloDrawingDetail />} />
          <Route path="/solo-twenty" element={<SoloTwenty />} />
          <Route path="/skill-names" element={<SkillNames />} />
          <Route path="/card-quiz" element={<CardQuiz />} />
          <Route path="/tier-list-maker" element={<TierListMaker />} />
          <Route path="/multiplayer" element={<Multiplayer />} />
          <Route path="/multiplayer/rooms/:roomId" element={<MultiplayerRoom />} />
          <Route path="/manage" element={<AdminIndex />} />
          <Route path="/manage/card-icons" element={<AdminCardIcons />} />
          <Route path="/manage/borders" element={<AdminBorders />} />
          <Route path="/manage/effect-tags" element={<AdminEffectTags />} />
          <Route path="/manage/duchmind-words" element={<AdminDuchMindWords />} />
          <Route path="/manage/points-grant" element={<AdminPointsGrant />} />
          <Route path="/manage/analytics" element={<AdminAnalytics />} />
          <Route path="/duchmind-wordpacks" element={<DuchMindWordPacks />} />
          <Route path="/duchmind-wordpacks/:packId" element={<DuchMindWordPackDetail />} />
          <Route path="/mypage/avatar" element={<MyAvatar />} />
          <Route path="/icon-shop" element={<IconShop />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/email-verified" element={<EmailVerified />} />
          <Route path="/recorder" element={<Tracker />} />
          <Route path="/tracker" element={<Navigate to="/recorder" replace />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="*" element={<NotFound />} />
      </Routes>
      {!inMultiplayerRoom && !drawingMode && <Footer />}
      {!drawingMode && <BottomTabBar />}
      <TrackerConfirmModal />
      {!inMultiplayerRoom && !drawingMode && <div className="sm:hidden h-16" />}
    </div>
  );
}

export default App;
