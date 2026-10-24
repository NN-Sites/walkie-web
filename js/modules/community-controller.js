// מחבר את הקהילה לאפליקציה: חסימה, הודעות מהמנהל, סקרים בין לשוניות,
// נוכחות על הקו בזמן נסיעה, דיווחים ושיתוף נסיעה בלייב.

import { t } from './i18n.js?v=1.6.0-mvn1g0s1';
import { showToast } from './ui.js?v=1.6.0-mvn1g0s1';
import { getFavorites } from './favorites.js?v=1.6.0-mvn1g0s1';
import { requireSignIn } from './auth-gate.js?v=1.6.0-mvn1g0s1';
import {
  checkBan, fetchBroadcasts, fetchActiveSurvey, fetchLineUsers, lineKeyOf, setPresence
} from './community.js?v=1.6.0-mvn1g0s1';
import {
  showBanScreen, showBroadcast, showSurvey, openShareChooser, openReportSheet
} from './community-ui.js?v=1.6.0-mvn1g0s1';
import { startLiveShare, stopLiveShare, isLiveSharing, liveShareUrl, sendLiveShareLink } from './live-share.js?v=1.6.0-mvn1g0s1';
import { setTripUsers } from './transit-ui.js?v=1.6.0-mvn1g0s1';

const SURVEY_LAST_KEY = 'walkie:survey:last';
const SURVEY_MIN_GAP_MS = 20 * 3600 * 1000;   // סקר אחד ביום, לא יותר
const SURVEY_AFTER_SWITCHES = 4;              // רק אחרי שהמשתמש כבר התנסה באפליקציה
const BROADCAST_RECHECK_MS = 5 * 60 * 1000;
const TRIP_TICK_MS = 15000;
const TRIP_USERS_MS = 60000;

export class CommunityController {
  /**
   * routes / transit – הבקרים של ניווט הליכה ונסיעה
   * getUser() – מיקום GPS אחרון
   * canInterrupt() – false בזמן מסלול / ניווט (לא מציגים סקר באמצע)
   * shareOnce() – השיתוף החד-פעמי הקיים (וואטסאפ עם זמן הגעה)
   */
  constructor({ routes, transit, getUser, canInterrupt, shareOnce }) {
    this.routes = routes;
    this.transit = transit;
    this.getUser = getUser;
    this.canInterrupt = canInterrupt;
    this.shareOnce = shareOnce;
    this.switches = 0;
    this.surveyChecked = false;
    this.lastBroadcastCheck = 0;
    this.lastUsersFetch = 0;
    this.banned = false;

    setInterval(() => this.#tripTick(), TRIP_TICK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkBroadcasts();
    });
  }

  /** אחרי שהסשן עלה: חסימה, ואז הודעות */
  async start() {
    const ban = await checkBan();
    if (ban.banned) {
      this.banned = true;
      showBanScreen(ban.reason);
      return;
    }
    this.checkBroadcasts();
  }

  #favoriteLineKeys() {
    return getFavorites().lines.map((l) => lineKeyOf({ mode: l.mode, line: l.line, agency: l.agency ?? '' }));
  }

  /** הודעות מהמנהל שעוד לא נראו (כולל הודעות לקו מסוים, אם הוא מועדף / פתוח / בנסיעה) */
  async checkBroadcasts(extraKeys = []) {
    if (this.banned || Date.now() - this.lastBroadcastCheck < 15000) return;
    this.lastBroadcastCheck = Date.now();
    const list = await fetchBroadcasts({ lineKeys: [...this.#favoriteLineKeys(), ...this.#tripLineKeys(), ...extraKeys] });
    if (list.length && !document.querySelector('.cm-modal')) showBroadcast(list[0]);
  }

  /** נקרא כשנפתח קו: הודעה מיוחדת לקו הזה */
  onLineOpened(lineKey) {
    this.lastBroadcastCheck = 0;
    this.checkBroadcasts([lineKey]);
  }

  /** נקרא בכל מעבר בין לשוניות: סקר מדי פעם, בין הכרטיסיות */
  async onTabSwitch() {
    if (this.banned) return;
    this.switches++;
    if (Date.now() - this.lastBroadcastCheck > BROADCAST_RECHECK_MS) this.checkBroadcasts();
    if (this.switches < SURVEY_AFTER_SWITCHES || this.surveyChecked) return;
    try {
      if (Date.now() - Number(localStorage.getItem(SURVEY_LAST_KEY) || 0) < SURVEY_MIN_GAP_MS) {
        this.surveyChecked = true;
        return;
      }
    } catch {
      // ignore
    }
    this.surveyChecked = true;
    const survey = await fetchActiveSurvey();
    if (!survey || !this.canInterrupt() || document.querySelector('.cm-modal, .premium-overlay')) return;
    try {
      localStorage.setItem(SURVEY_LAST_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    showSurvey(survey);
  }

  // ---------- נסיעה ----------

  #rideLeg() {
    const st = this.transit.isTripping ? this.transit.trip?.session.state : null;
    return st ? [st.leg, st.next].find((l) => l && l.mode !== 'walk') ?? null : null;
  }

  #tripLineKeys() {
    const leg = this.#rideLeg();
    return leg ? [lineKeyOf({ mode: leg.mode, line: leg.line, agency: leg.agency ?? '' })] : [];
  }

  /** נוכחות על הקו שנוסעים בו + כמה משתמשי Walkie עליו; וסיום שיתוף בלייב כשהנסיעה נגמרה */
  async #tripTick() {
    const leg = this.#rideLeg();
    if (leg) {
      const key = lineKeyOf({ mode: leg.mode, line: leg.line, agency: leg.agency ?? '' });
      setPresence('trip', { lineKey: key, line: leg.line });
      if (Date.now() - this.lastUsersFetch > TRIP_USERS_MS) {
        this.lastUsersFetch = Date.now();
        const n = await fetchLineUsers(key);
        if (n != null) setTripUsers(n);
      }
    } else {
      setPresence('trip', null);
      setTripUsers(null);
    }
    if (isLiveSharing() && !this.routes.isNavigating && !this.transit.isTripping) stopLiveShare();
  }

  #currentTrip() {
    if (this.routes.isNavigating && this.routes.model) {
      return {
        destName: this.routes.dest?.name ?? t('היעד'),
        dest: this.routes.dest,
        mode: 'walk',
        lineText: null,
        geometry: this.routes.model.geometry,
        arrival: () => (this.routes.session?.state ? new Date(Date.now() + this.routes.session.state.remainingSeconds * 1000).toISOString() : null)
      };
    }
    if (this.transit.isTripping && this.transit.trip) {
      const leg = this.#rideLeg();
      return {
        destName: this.transit.request?.dest?.name ?? t('היעד'),
        dest: this.transit.request?.dest,
        mode: 'transit',
        lineText: leg ? (leg.mode === 'rail' ? t('רכבת') : t('קו {line}', { line: leg.line })) : null,
        geometry: this.transit.trip.model.geometry,
        arrival: () => this.transit.trip.session.state?.arrival ?? null
      };
    }
    return null;
  }

  /** כפתור השיתוף בליווי נסיעה: שיתוף חד-פעמי או בלייב */
  openTripShare() {
    if (!requireSignIn(t('לשתף'), () => this.openTripShare())) return;
    const trip = this.#currentTrip();
    if (!trip) {
      this.shareOnce();
      return;
    }
    openShareChooser({
      live: isLiveSharing() ? { url: liveShareUrl() } : null,
      onOnce: () => this.shareOnce(),
      onLive: async () => {
        if (isLiveSharing()) {
          sendLiveShareLink(liveShareUrl(), trip.destName);
          return;
        }
        const share = await startLiveShare({
          trip,
          getState: () => ({ pos: this.getUser(), arrival: this.#currentTrip()?.arrival() })
        });
        sendLiveShareLink(share.url, trip.destName);
      },
      onStop: () => stopLiveShare(),
      onCopy: async () => {
        try {
          await navigator.clipboard.writeText(liveShareUrl());
          showToast(t('הקישור הועתק'));
        } catch {
          showToast(liveShareUrl());
        }
      }
    });
  }

  handleAction(action, data) {
    if (action === 'report-line') {
      openReportSheet({ lineKey: data.lineKey, line: data.line, lineLabel: data.label });
      return true;
    }
    return false;
  }
}
