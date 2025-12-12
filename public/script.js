// ===================================
// 認証・ユーザー情報関連
// ===================================
document.addEventListener('DOMContentLoaded', async () => {
  // ログインユーザー情報の取得
  try {
    const res = await fetch('/api/check');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('username-display').textContent = `ようこそ、${data.username}さん`;
    } else {
      // 認証されていない場合は、server.jsでlogin.htmlにリダイレクトされる想定
      console.warn('ユーザー情報が取得できませんでした。');
    }
  } catch (error) {
    console.error('ログインチェックエラー:', error);
  }

  // ログアウト処理
  document.getElementById('logout-button').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        location.href = 'login.html';
      } else {
        alert('ログアウトに失敗しました。');
      }
    } catch (error) {
      console.error('ログアウトエラー:', error);
      alert('ログアウト処理中にエラーが発生しました。');
    }
  });

  // ランキングの読み込み
  loadRanking();
});

async function loadRanking() {
  const rankingTableBody = document.querySelector('#ranking-table tbody');
  const rankingStatus = document.getElementById('ranking-status');
  const rankingTable = document.getElementById('ranking-table');

  rankingStatus.textContent = 'ランキングを読み込み中...';
  rankingTableBody.innerHTML = '';
  rankingTable.classList.add('hidden');

  try {
    const res = await fetch('/api/scores/ranking');
    if (res.ok) {
      const rankingData = await res.json();
      rankingStatus.classList.add('hidden');
      rankingTable.classList.remove('hidden');

      if (rankingData.length === 0) {
        rankingStatus.textContent = 'まだスコアがありません。';
        rankingStatus.classList.remove('hidden');
        rankingTable.classList.add('hidden');
        return;
      }

      rankingData.forEach((score, index) => {
        const row = rankingTableBody.insertRow();
        row.insertCell().textContent = index + 1;
        row.insertCell().textContent = score.username;
        row.insertCell().textContent = score.wpm.toFixed(0);
        row.insertCell().textContent = `${score.accuracy.toFixed(2)}%`;
        row.insertCell().textContent = score.score.toFixed(0);
      });
    } else {
      rankingStatus.textContent = 'ランキングの取得に失敗しました。';
    }
  } catch (error) {
    console.error('ランキング取得エラー:', error);
    rankingStatus.textContent = 'ランキングの取得中にエラーが発生しました。';
  }
}

// ===================================
// タイピングゲームロジック
// ===================================
const startButton = document.getElementById('start-button');
const questionArea = document.getElementById('question-area');
const statsArea = document.getElementById('stats-area');
const displayText = document.getElementById('display-text');
const inputField = document.getElementById('input-field');

let questions = []; // 取得した問題リスト
let currentQuestionIndex = 0; // 現在の問題番号
let currentText = ''; // 現在表示されているテキスト
let expectedKey = ''; // 次に入力すべき文字
let startTime = 0; // 開始時刻
let timerInterval = null; // タイマー
let correctChars = 0; // 正しく入力した文字数
let totalChars = 0; // 総入力文字数（間違いを含む）

// 状態表示要素
const timerDisplay = document.getElementById('timer');
const wpmDisplay = document.getElementById('wpm-display');
const correctCountDisplay = document.getElementById('correct-count');
const totalCountDisplay = document.getElementById('total-count');
const accuracyDisplay = document.getElementById('accuracy-display');

// ゲームスタート
startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.textContent = '問題を読み込み中...';

  try {
    const res = await fetch('/api/questions');
    if (!res.ok) {
      throw new Error('質問の取得に失敗しました。');
    }
    questions = await res.json();

    if (questions.length === 0) {
      alert('問題が取得できませんでした。');
      return;
    }

    // ゲーム初期化
    currentQuestionIndex = 0;
    correctChars = 0;
    totalChars = 0;
    startTime = Date.now();
    clearInterval(timerInterval);

    // UI表示
    startButton.classList.add('hidden');
    questionArea.classList.remove('hidden');
    statsArea.classList.remove('hidden');
    inputField.disabled = false;
    inputField.focus();

    // 最初の問題を表示
    showNextQuestion();

    // タイマー開始
    timerInterval = setInterval(updateStats, 1000);
  } catch (error) {
    console.error('ゲーム開始エラー:', error);
    alert('ゲームの開始中にエラーが発生しました。');
    startButton.disabled = false;
    startButton.textContent = 'ゲームスタート';
  }
});

// 次の問題を表示する
function showNextQuestion() {
  if (currentQuestionIndex >= questions.length) {
    // 全問終了
    endGame();
    return;
  }

  // HTMLエンティティをデコード (opentdbの仕様)
  const rawQuestion = questions[currentQuestionIndex].question;
  currentText = decodeHtmlEntities(rawQuestion);

  // 表示を初期化
  displayText.innerHTML = '';

  // 一文字ずつspanタグで囲んで表示
  for (const char of currentText) {
    const span = document.createElement('span');
    span.textContent = char;
    displayText.appendChild(span);
  }

  // 入力フィールドをクリア
  inputField.value = '';
  // 最初の文字をハイライト
  expectedKey = currentText[0];
  highlightNextChar(0);
}

// 入力イベントの処理
inputField.addEventListener('input', (e) => {
  const inputText = inputField.value;
  const currentLength = inputText.length;

  // 全入力文字数の更新
  totalChars++;

  // 現在入力された文字と、期待される文字を比較
  if (currentLength > 0) {
    const lastInputChar = inputText[currentLength - 1];
    const expectedChar = currentText[currentLength - 1];

    const charSpan = displayText.children[currentLength - 1];

    if (lastInputChar === expectedChar) {
      // 正解
      correctChars++;
      charSpan.className = 'correct';
    } else {
      // 不正解
      charSpan.className = 'incorrect';
    }
  }

  // 統計情報の更新
  updateStats();

  // 全て入力が完了したかチェック
  if (currentLength === currentText.length) {
    currentQuestionIndex++;

    // 次の問題を少し遅延させて表示
    setTimeout(showNextQuestion, 100);
    return;
  }

  // 次の文字をハイライト
  highlightNextChar(currentLength);
});

// 次に入力すべき文字をハイライト
function highlightNextChar(index) {
  // 全ての子要素から 'next' クラスを削除
  Array.from(displayText.children).forEach((span) => span.classList.remove('next'));

  if (index < displayText.children.length) {
    displayText.children[index].classList.add('next');
  }
}

// 統計情報を更新し、ゲームが終了した場合はスコアを送信
function updateStats() {
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const accuracy = totalChars > 0 ? (correctChars / totalChars) * 100 : 0;

  // WPM: 5文字を1ワードとして、経過秒数から計算 (WPM = (正解文字数 / 5) / (経過時間 / 60))
  const wpm = elapsedSeconds > 0 ? correctChars / 5 / (elapsedSeconds / 60) : 0;

  // UI更新
  timerDisplay.textContent = elapsedSeconds;
  wpmDisplay.textContent = wpm.toFixed(0);
  correctCountDisplay.textContent = correctChars;
  totalCountDisplay.textContent = totalChars;
  accuracyDisplay.textContent = `${accuracy.toFixed(2)}%`;
}

// ゲーム終了処理
async function endGame() {
  clearInterval(timerInterval);
  inputField.disabled = true;

  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const accuracy = totalChars > 0 ? (correctChars / totalChars) * 100 : 0;
  const wpm = elapsedSeconds > 0 ? correctChars / 5 / (elapsedSeconds / 60) : 0;
  const score = correctChars * 10 - (totalChars - correctChars) * 5; // 簡易スコア計算

  alert(`🎉ゲーム終了🎉\nスコア: ${score.toFixed(0)}\nWPM: ${wpm.toFixed(0)}\n正答率: ${accuracy.toFixed(2)}%`);

  // スコアをサーバーに保存
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score: score,
        wpm: wpm,
        accuracy: accuracy
      })
    });

    if (res.ok) {
      console.log('スコア保存成功');
      loadRanking(); // ランキングを更新
    } else {
      const data = await res.json();
      console.error('スコア保存失敗:', data.message);
    }
  } catch (error) {
    console.error('スコア送信エラー:', error);
  }

  // ゲームリセットのためのUI
  startButton.classList.remove('hidden');
  startButton.textContent = 'もう一度プレイ';
  startButton.disabled = false;
}

// HTMLエンティティデコード関数 (OpenTDBからのデータはエスケープされているため)
function decodeHtmlEntities(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc.documentElement.textContent;
}
