import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import './App.css'
import Navbar from "./components/Navbar";
import BottomTabBar from "./components/BottomTabBar";
import { useDrawingMode } from "./lib/drawingMode";
import TrackerBanner from "./components/TrackerBanner";
import TrackerConfirmModal from "./components/TrackerConfirmModal";
import Footer from "./components/Footer";
import Info from "./pages/Info";
import { usePageTracking } from "./hooks/usePageTracking";
import { useScrollRestoration } from "./hooks/useScrollRestoration";
import NoticePopup from "./components/NoticePopup";
import StaffInquiryAlert from "./components/StaffInquiryAlert";
import TournamentNoticePopup from "./components/TournamentNoticePopup";

// Every page but the home page is fetched when it is first opened (2026-10-12, 엘리스: the site was one 1.5 MB
// bundle, so opening a card page also fetched the charts, the markdown editor, the tier list maker and the games).
const Recommend = lazy(() => import("./pages/Recommend"));
const QuestionPage = lazy(() => import("./pages/QuestionPage"));
const ResultPage = lazy(() => import("./pages/ResultPage"));
const Terms = lazy(() => import("./pages/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Unauthorized = lazy(() => import("./pages/Unauthorized"));
const Register = lazy(() => import("./pages/Register"));
const Login = lazy(() => import("./pages/Login"));
const Mypage = lazy(() => import("./pages/Mypage"));
const PointsHistory = lazy(() => import("./pages/PointsHistory"));
const NotificationHistory = lazy(() => import("./pages/NotificationHistory"));
const AdminPointsGrant = lazy(() => import("./pages/AdminPointsGrant"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const AdminCharts = lazy(() => import("./pages/AdminCharts"));
const AdminIndex = lazy(() => import("./pages/AdminIndex"));
const Mydecks = lazy(() => import("./pages/Mydecks"));
const Noresults = lazy(() => import("./pages/Noresults"));
const DatabasePage = lazy(() => import("./pages/Database"));
const DeckDetail = lazy(() => import("./pages/DeckDetail"));
const CardList = lazy(() => import("./pages/CardList"));
const CardDetail = lazy(() => import("./pages/CardDetail"));
const RecordGroups = lazy(() => import("./pages/RecordGroups"));
const RecordGroupDetail = lazy(() => import("./pages/RecordGroupDetail"));
const RecordGroupStatistics = lazy(() => import("./pages/RecordGroupStatistics"));
const Tournaments = lazy(() => import("./pages/Tournaments"));
const TournamentHub = lazy(() => import("./pages/TournamentHub"));
const CreateTournament = lazy(() => import("./pages/CreateTournament"));
const TournamentDetailPage = lazy(() => import("./pages/TournamentDetail"));
const DeckScanner = lazy(() => import("./pages/DeckScanner"));
const CardQuiz = lazy(() => import("./pages/CardQuiz"));
const Playground = lazy(() => import("./pages/Playground"));
const AllMenu = lazy(() => import("./pages/AllMenu"));
const Tools = lazy(() => import("./pages/Tools"));
const Solo = lazy(() => import("./pages/Solo"));
const SoloDuchmind = lazy(() => import("./pages/SoloDuchmind"));
const SoloDraw = lazy(() => import("./pages/SoloDraw"));
const SoloDrawingDetail = lazy(() => import("./pages/SoloDrawingDetail"));
const SoloTwenty = lazy(() => import("./pages/SoloTwenty"));
const SkillNames = lazy(() => import("./pages/SkillNames"));
const TierListMaker = lazy(() => import("./pages/TierListMaker"));
const Multiplayer = lazy(() => import("./pages/Multiplayer"));
const MultiplayerRoom = lazy(() => import("./pages/MultiplayerRoom"));
const AdminCardIcons = lazy(() => import("./pages/AdminCardIcons"));
const AdminBorders = lazy(() => import("./pages/AdminBorders"));
const AdminEffectTags = lazy(() => import("./pages/AdminEffectTags"));
const AdminCardGroups = lazy(() => import("./pages/AdminCardGroups"));
const AdminScanLabels = lazy(() => import("./pages/AdminScanLabels"));
const AdminDuchMindWords = lazy(() => import("./pages/AdminDuchMindWords"));
const DuchMindWordPacks = lazy(() => import("./pages/DuchMindWordPacks"));
const DuchMindWordPackDetail = lazy(() => import("./pages/DuchMindWordPackDetail"));
const MyAvatar = lazy(() => import("./pages/MyAvatar"));
const IconShop = lazy(() => import("./pages/IconShop"));
const Changelog = lazy(() => import("./pages/Changelog"));
const InquiryHome = lazy(() => import("./pages/InquiryHome"));
const InquiryBoardPage = lazy(() => import("./pages/InquiryBoardPage"));
const InquiryPostPage = lazy(() => import("./pages/InquiryPostPage"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const EmailVerified = lazy(() => import("./pages/EmailVerified"));
const Tracker = lazy(() => import("./pages/Tracker"));

// Shown while a page's code arrives: keeps the footer below the fold, as the page will.
const PAGE_FALLBACK = <div className="min-h-screen" />;

// The book's pages most people open next, fetched once the browser is idle so going there needs no wait.
function prefetchCommonPages() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  for (const load of [() => import("./pages/Database"), () => import("./pages/DeckDetail"), () => import("./pages/CardList"),
                      () => import("./pages/CardDetail")]) {
    load().catch(() => {});
  }
}

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
  // The card list is kept the same way behind a card page.
  const onCardList = pathname === "/cards";
  const inCardBook = onCardList || pathname.startsWith("/cards/");
  const [cardListOpened, setCardListOpened] = useState(onCardList);
  if (onCardList && !cardListOpened) setCardListOpened(true);
  if (!inCardBook && cardListOpened) setCardListOpened(false);
  const keepCardList = onCardList || (cardListOpened && inCardBook);
  // While a player is actively drawing (DuchMind turn / Solo draw page),
  // all site chrome is hidden so nothing overlaps the canvas.
  const drawingMode = useDrawingMode();

  // Every move to another page eases the content in, like the tendency test (특이점 2026-10-11). It is an animation
  // on the box around the pages, not a remount, so the kept lists above and every page's state stay as they are;
  // query-only changes (?tab=, filters) don't count as a move.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
    idle(prefetchCommonPages);
  }, []);

  const pageRef = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pageRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
  }, [pathname]);

  return (
    <div>
      {!drawingMode && <TrackerBanner />}
      {!drawingMode && (
        <div className="site-header-bleed">
          <Navbar />
        </div>
      )}
      <NoticePopup disabled={drawingMode || inMultiplayerRoom} />
      <StaffInquiryAlert disabled={drawingMode || inMultiplayerRoom} />
      <TournamentNoticePopup disabled={drawingMode || inMultiplayerRoom} />
      <div ref={pageRef}>
        {keepDeckList && (
          <div hidden={!onDeckList}>
            <Suspense fallback={onDeckList ? PAGE_FALLBACK : null}>
              <DatabasePage />
            </Suspense>
          </div>
        )}
        {keepCardList && (
          <div hidden={!onCardList}>
            <Suspense fallback={onCardList ? PAGE_FALLBACK : null}>
              <CardList />
            </Suspense>
          </div>
        )}
        <Suspense fallback={PAGE_FALLBACK}>
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
            <Route path="/mypage/notifications" element={<NotificationHistory />} />
            <Route path="/mypage/mydecks" element={<Mydecks />} />
            <Route path="/no-results" element={<Noresults />} />
            <Route path="/database" element={null} />
            <Route path="/database/:deckId" element={<DeckDetail />} />
            <Route path="/cards" element={null} />
            <Route path="/cards/:cardId" element={<CardDetail />} />
            <Route path="/records" element={<RecordGroups />} />
            <Route path="/record-groups/statistics" element={<RecordGroupStatistics />} />
            {/* 대회 (내부 테스트 중 — 네비게이션 미노출) */}
            <Route path="/tournaments" element={<TournamentHub />} />
            <Route path="/tournaments/join" element={<Tournaments />} />
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
            <Route path="/manage/card-groups" element={<AdminCardGroups />} />
            <Route path="/manage/scan-labels" element={<AdminScanLabels />} />
            <Route path="/manage/duchmind-words" element={<AdminDuchMindWords />} />
            <Route path="/manage/points-grant" element={<AdminPointsGrant />} />
            <Route path="/manage/analytics" element={<AdminAnalytics />} />
            <Route path="/manage/charts" element={<AdminCharts />} />
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
            <Route path="/inquiry" element={<InquiryHome />} />
            <Route path="/inquiry/post/:id" element={<InquiryPostPage />} />
            <Route path="/inquiry/:board" element={<InquiryBoardPage />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </div>
      {!inMultiplayerRoom && !drawingMode && <Footer />}
      {!drawingMode && <BottomTabBar />}
      <TrackerConfirmModal />
      {!inMultiplayerRoom && !drawingMode && <div className="sm:hidden h-16" />}
    </div>
  );
}

export default App;
