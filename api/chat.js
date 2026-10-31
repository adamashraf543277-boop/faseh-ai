
const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/chat/completions";

const MODEL = "llama-3.3-70b-versatile";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GROQ_API_KEY is missing from Vercel Environment Variables.",
    });
  }

  try {
    const { messages, lessonContext } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Please send a message.",
      });
    }

    if (messages.length > 30) {
      return res.status(400).json({
        error: "Conversation is too long.",
      });
    }

    const systemInstruction = `
أنت فصيح AI، معلم لغة عربية ذكي ولطيف
متخصص في مساعدة تلاميذ الصف السادس الابتدائي في مصر.

قواعدك:

1. أجب باللغة العربية الواضحة والمناسبة للمرحلة الابتدائية.
2. اشرح خطوة بخطوة بطريقة سهلة.
3. ساعد الطالب في النحو والإملاء والقراءة والتعبير.
4. عند الإعراب اذكر الموقع الإعرابي والعلامة والسبب.
5. وضح أنواع الخبر والمبتدأ عند الحاجة.
6. استخدم أمثلة سهلة.
7. لا تخترع معلومات.
8. كن مشجعًا وصبورًا ومحترمًا.
9. اجعل إجاباتك منظمة.
10. إذا طلب الطالب إجابة مباشرة، أجب مباشرة.
11. إذا طلب شرحًا تفصيليًا، اشرح بالتفصيل.
12. استخدم سياق المحادثة السابقة.
13. اعتمد على الدرس المرفق عند الإجابة عن أسئلته.

معلومات الدرس الحالي:
${lessonContext
  ? JSON.stringify(lessonContext)
  : "لا يوجد درس محدد حاليًا."}
`;

    const validMessages = messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim().length > 0
      )
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content.trim(),
      }));

    if (!validMessages.length) {
      return res.status(400).json({
        error: "No valid messages.",
      });
    }

    const requestBody = {
      model: MODEL,

      messages: [
        {
          role: "system",
          content: systemInstruction,
        },
        ...validMessages,
      ],

      temperature: 0.6,
      max_tokens: 900,
      top_p: 0.9,
      stream: false,
    };

    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        20000
      );

      try {
        const response = await fetch(GROQ_ENDPOINT, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },

          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        const result = await response.json();

        if (response.ok) {
          const reply =
            result.choices?.[0]?.message?.content?.trim();

          if (!reply) {
            return res.status(502).json({
              error: "Faseeh could not generate an answer.",
            });
          }

          return res.status(200).json({ reply });
        }

        const errorMessage =
          result.error?.message || "Groq request failed.";

        lastError = new Error(errorMessage);

        const retryable = [429, 500, 502, 503, 504];

        if (!retryable.includes(response.status) || attempt === 2) {
          console.error("Groq API error:", {
            status: response.status,
            message: errorMessage,
          });

          return res.status(response.status).json({
            error: errorMessage,
          });
        }

        await sleep(1000);

      } catch (error) {
        lastError = error;

        if (attempt === 2) {
          console.error("Groq connection error:", error);

          return res.status(
            error.name === "AbortError" ? 504 : 502
          ).json({
            error:
              error.name === "AbortError"
                ? "Faseeh took too long to respond."
                : "Could not connect to Groq.",
          });
        }

        await sleep(500);

      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(502).json({
      error: lastError?.message || "Groq is unavailable.",
    });

  } catch (error) {
    console.error("FASEEH SERVER ERROR:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred.",
    });
  }
};

// ==========================================
// FASEEH AI - GROQ FRONTEND CONNECTION
// ==========================================

const FASEEH_API = "/api/chat";

// Conversation history
let messages = [];

// Current lesson context
let lessonContext = null;

// Prevent overlapping requests
let isThinking = false;


// ==========================================
// SEND MESSAGE TO FASEEH
// ==========================================

async function sendToFaseeh(userMessage) {

  if (isThinking) {
    return null;
  }

  if (
    typeof userMessage !== "string" ||
    !userMessage.trim()
  ) {
    return null;
  }

  isThinking = true;

  messages.push({
    role: "user",
    content: userMessage.trim(),
  });

  try {

    const response = await fetch(FASEEH_API, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        messages,
        lessonContext,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Faseeh could not respond."
      );
    }

    if (!data.reply) {
      throw new Error("Empty response from Faseeh.");
    }

    messages.push({
      role: "assistant",
      content: data.reply,
    });

    return data.reply;

  } catch (error) {

    console.error("FASEEH ERROR:", error);

    // Remove unanswered message so it isn't
    // accidentally duplicated in conversation history.
    messages.pop();

    throw error;

  } finally {
    isThinking = false;
  }
}


// ==========================================
// UPDATE LESSON CONTEXT
// ==========================================

function setFaseehLesson(lesson) {
  lessonContext = lesson;
}


// ==========================================
// CLEAR CHAT
// ==========================================

function clearFaseehChat() {
  if (isThinking) return;

  messages = [];
}


// ==========================================
// GET CONVERSATION HISTORY
// ==========================================

function getFaseehMessages() {
  return [...messages];
}

// ==========================================
// SIMPLE FASEEH CHAT UI
// ==========================================

const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");

if (chatInput && sendButton && chatMessages) {

  sendButton.addEventListener("click", handleSend);

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });

  async function handleSend() {

    const text = chatInput.value.trim();

    if (!text || isThinking) return;

    chatInput.value = "";

    // Show user message
    addMessage("user", text);

    // Show loading message
    const loading = addMessage("assistant", "فصيح يفكر...");

    sendButton.disabled = true;

    try {

      const reply = await sendToFaseeh(text);

      loading.textContent = reply;

    } catch (error) {

      loading.textContent =
        "عذرًا، حدث خطأ أثناء الاتصال. حاول مرة أخرى.";

      console.error(error);

    } finally {
      sendButton.disabled = false;
    }
  }

  function addMessage(role, content) {

    const message = document.createElement("div");

    message.className = `message ${role}`;
    message.textContent = content;

    chatMessages.appendChild(message);

    chatMessages.scrollTop =
      chatMessages.scrollHeight;

    return message;
  }
}
