
const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const GEMINI_MODEL = "gemini-3.8-flash";

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async function handler(req, res) {
  // POST only
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  // Get API key from Vercel
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing from Vercel Environment Variables.",
    });
  }

  try {
    const { messages, lessonContext } = req.body || {};

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Please send a message.",
      });
    }

    // Faseeh AI instructions
    const systemInstruction = `
أنت فصيح AI، معلم لغة عربية ذكي ولطيف
متخصص في مساعدة تلاميذ الصف السادس الابتدائي في مصر.

قواعدك:

1. أجب باللغة العربية الواضحة والمناسبة للمرحلة الابتدائية.
2. اشرح المعلومات خطوة بخطوة وبطريقة سهلة.
3. ساعد الطالب على فهم النحو والإملاء والقراءة والتعبير.
4. عند الإعراب، اذكر السبب والعلامة الإعرابية.
5. لا تخترع معلومات إذا لم تكن متأكدًا منها.
6. كن مشجعًا وصبورًا ومحترمًا دائمًا.
7. اجعل إجاباتك منظمة ومختصرة قدر الإمكان.
8. إذا كان هناك درس مرفق، استخدمه في الإجابة.
9. استخدم أمثلة واضحة عند شرح القواعد.
10. لا تتجاهل سياق المحادثة السابقة.

معلومات الدرس الحالي:
${lessonContext
  ? JSON.stringify(lessonContext)
  : "لا يوجد درس محدد حاليًا."}
`;

    // Convert conversation to Gemini format
    const contents = messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim().length > 0
      )
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    if (contents.length === 0) {
      return res.status(400).json({
        error: "No valid messages were provided.",
      });
    }

    // Gemini request
    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },

      contents,

      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1200,
        topP: 0.9,
      },
    };

    let lastError = null;

    // 3 attempts: initial request + 2 retries
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(GEMINI_ENDPOINT, {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },

          body: JSON.stringify(requestBody),
        });

        const result = await response.json();

        // Successful response
        if (response.ok) {
          const candidate = result.candidates?.[0];

          const reply = candidate?.content?.parts
            ?.map((part) => part.text || "")
            .join("")
            .trim();

          if (!reply) {
            console.error(
              "Gemini returned no text:",
              candidate?.finishReason
            );

            return res.status(502).json({
              error:
                "Gemini could not generate a response. Please try again.",
            });
          }

          return res.status(200).json({
            reply,
          });
        }

        // API error
        const errorMessage =
          result.error?.message || "Gemini request failed.";

        lastError = new Error(errorMessage);

        const retryableErrors = [
          429,
          500,
          502,
          503,
          504,
        ];

        if (
          !retryableErrors.includes(response.status) ||
          attempt === 3
        ) {
          console.error("Gemini API error:", {
            status: response.status,
            message: errorMessage,
            attempt,
          });

          return res.status(response.status).json({
            error: errorMessage,
          });
        }

        console.log(
          `Gemini temporarily unavailable. Retry ${attempt}/2...`
        );

      } catch (error) {
        lastError = error;

        if (attempt === 3) {
          console.error("Gemini connection error:", error);

          return res.status(502).json({
            error:
              "Could not connect to Gemini. Please try again later.",
          });
        }

        console.log(
          `Gemini connection failed. Retry ${attempt}/2...`
        );
      }

      // Retry delays: 1 second, then 2 seconds
      await sleep(attempt * 1000);
    }

    return res.status(502).json({
      error:
        lastError?.message ||
        "Gemini is temporarily unavailable.",
    });

  } catch (error) {
    console.error("FASEEH API error:", error);

    return res.status(500).json({
      error: "An unexpected server error occurred.",
    });
  }
};
