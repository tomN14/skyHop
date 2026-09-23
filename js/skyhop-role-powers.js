/**
 * Role power lists. Report Advisors see only theirs. Moderators see only theirs.
 * Admin sees Report Advisor, moderator, and Admin. The owner sees all three.
 */
(function () {
  var LISTS = {
    report_advisor: {
      title: 'Report Advisor',
      powers: [
        'Open the reports inbox.',
        'See how many pending reports are waiting.',
        'Read pending player reports.',
        'Dismiss a report that is not valid.',
        'Escalate a report to the owner.',
        'Read this Report Advisor power list.',
      ],
    },
    moderator: {
      title: 'Moderator',
      powers: [
        'Open the reports inbox.',
        'See how many pending reports and ban appeals are waiting.',
        'Read pending player reports.',
        'Reject a report that is not valid.',
        'Escalate a report to the owner.',
        'Vote on a ban appeal: unban, or keep the ban.',
        'Open the moderator dashboard.',
        'See site visit counts.',
        'Look up a player’s stats and level list.',
        'Edit or delete another player’s levels. The owner’s levels stay view-only.',
        'Review submitted campaign runs and approve or decline them.',
        'Watch any live race or collab, public or private.',
        'Remove a player from a live race or collab.',
        'Add, edit, or delete chat in a race or collab.',
        'Messages you add show as SkyHopMod_ plus five random digits. A new alias is chosen for every message.',
        'Read this moderator power list.',
      ],
    },
    admin: {
      title: 'Admin',
      powers: [
        'Open the reports inbox.',
        'See how many pending reports and ban appeals are waiting.',
        'Read pending player reports.',
        'Reject a report that is not valid.',
        'Escalate a report to the owner.',
        'Vote on a ban appeal: unban, or keep the ban.',
        'Open the moderator dashboard.',
        'See site visit counts.',
        'Look up a player’s stats and level list.',
        'Edit or delete another player’s levels. The owner’s levels stay view-only.',
        'Review submitted campaign runs and approve or decline them.',
        'Watch any live race or collab, public or private.',
        'Remove a player from a live race or collab.',
        'Add, edit, or delete chat in a race or collab.',
        'Messages you add show as SkyHopMod_ plus five random digits. A new alias is chosen for every message.',
        'Click a SkyHopMod alias to see which moderator posted that message.',
        'Read the Report Advisor, moderator, and Admin power lists.',
        'Promote a player to moderator.',
        'Ban a player or Report Advisor for 1 day, up to 2 times in 7 days.',
        'Ask the owner to apply a longer ban.',
        'Ask the owner to demote a moderator.',
        'Look up strike counts for players, Report Advisors, and moderators.',
      ],
    },
  };

  function listsFor(role) {
    if (role === 'owner' || role === 'admin') return ['report_advisor', 'moderator', 'admin'];
    if (role === 'moderator') return ['moderator'];
    if (role === 'report_advisor') return ['report_advisor'];
    return [];
  }

  function myRole() {
    var me = window.__skyhopLastMe;
    return me && me.role ? me.role : 'player';
  }

  var activeKey = '';

  function paintTabs(keys) {
    var bar = document.getElementById('rolePowersTabs');
    if (!bar) return;
    bar.textContent = '';
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = LISTS[key].title;
        btn.className =
          'rounded-xl border px-3 py-1.5 text-xs font-semibold ' +
          (key === activeKey
            ? 'border-indigo-400 bg-indigo-950/70 text-indigo-100'
            : 'border-white/15 bg-slate-950/70 text-slate-300');
        btn.addEventListener('click', function () {
          activeKey = key;
          paintTabs(keys);
          paintList(key);
        });
        bar.appendChild(btn);
      })(keys[i]);
    }
  }

  function paintList(key) {
    var ul = document.getElementById('rolePowersList');
    var list = LISTS[key];
    if (!ul || !list) return;
    ul.textContent = '';
    for (var i = 0; i < list.powers.length; i++) {
      var li = document.createElement('li');
      li.textContent = list.powers[i];
      ul.appendChild(li);
    }
  }

  function openPowers() {
    var keys = listsFor(myRole());
    var screen = document.getElementById('screenRolePowers');
    if (!keys.length || !screen) return;
    if (keys.indexOf(activeKey) < 0) activeKey = keys[0];
    var hint = document.getElementById('rolePowersHint');
    if (hint) {
      hint.textContent =
        myRole() === 'owner'
          ? 'You can read every role list.'
          : myRole() === 'admin'
            ? 'You can read the Report Advisor, moderator, and Admin lists.'
            : 'This list is only for your role.';
    }
    paintTabs(keys);
    paintList(activeKey);
    screen.classList.remove('hidden');
    screen.classList.add('flex');
  }

  function closePowers() {
    var screen = document.getElementById('screenRolePowers');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function syncFab() {
    var fab = document.getElementById('btnRolePowersFab');
    if (!fab) return;
    fab.classList.toggle('hidden', listsFor(myRole()).length === 0);
  }

  function bind() {
    var fab = document.getElementById('btnRolePowersFab');
    var close = document.getElementById('btnRolePowersClose');
    if (fab) fab.addEventListener('click', openPowers);
    if (close) close.addEventListener('click', closePowers);
    syncFab();
  }

  window.SkyHopSyncRolePowers = syncFab;
  window.SkyHopOpenRolePowers = openPowers;
  window.addEventListener('skyhop-auth-changed', syncFab);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
