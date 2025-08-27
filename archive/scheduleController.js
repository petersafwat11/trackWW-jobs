// Track container and send email notification with PDF
exports.trackContainerAndNotify = catchAsync(async (req, res, next) => {
  try {
    const { container_no, email_to } = req.body;

    // Validate required fields
    if (!container_no || !email_to) {
      return next(
        new AppError("Container number and email address are required", 400)
      );
    }

    // Get user data from authenticated user (optional, for logging)
    const user_id = req.user?.user_id || "system";

    // Define ocean tracking APIs to try
    const oceanAPIs = [
      { menu_id: "ocean-af", name: "AllForward" },
      { menu_id: "ocean-ft", name: "FindTeu" },
      { menu_id: "ocean-sr", name: "SeaRates" },
    ];

    let trackingData = null;
    let metadata = null;
    let apiUsed = null;

    // Try each API until we get data
    for (const api of oceanAPIs) {
      try {
        // Get API endpoint
        const endpoint = await Endpoint.findByMenuId(api.menu_id);
        if (!endpoint) {
          console.log(`No endpoint found for menu_id: ${api.menu_id}`);
          continue;
        }

        console.log(
          `Trying API: ${api.name} with endpoint: ${endpoint.endpoint}`
        );

        // Format the external API URL
        const externalApiUrl = `${endpoint.endpoint}${container_no}`;

        // Make the API request through our tracking endpoint
        const response = await axios.get(
          `${
            process.env.BACKEND_SERVER || "http://localhost:5000"
          }/api/tracking/${container_no}`,
          {
            params: { externalApiUrl },
            timeout: 30000,
          }
        );

        const responseData = response?.data?.data;
        console.log(
          "API Response Data:",
          JSON.stringify(responseData, null, 2)
        );

        // Check if we got valid data based on API type
        let hasValidData = false;
        let extractedEvents = [];

        if (responseData) {
          if (
            api.menu_id === "ocean-af" &&
            responseData.containerPosition?.data?.containers?.[0]?.events
              ?.length > 0
          ) {
            // AllForward API structure
            hasValidData = true;
            extractedEvents =
              responseData.containerPosition.data.containers[0].events;
          } else if (
            api.menu_id === "ocean-sr" &&
            responseData.data?.containers?.[0]?.events?.length > 0
          ) {
            // SeaRates API structure
            hasValidData = true;
            extractedEvents = responseData.data.containers[0].events;
          } else if (
            api.menu_id === "ocean-ft" &&
            responseData.events?.length > 0
          ) {
            // FindTeu API structure
            hasValidData = true;
            extractedEvents = responseData.events;
          }
        }

        if (hasValidData && extractedEvents.length > 0) {
          trackingData = responseData;
          apiUsed = api.name;

          // Generate metadata based on the response structure
          metadata = generateOceanTrackingMetadata(
            responseData,
            container_no,
            api.menu_id
          );

          // Log successful tracking
          await Tracking.logTracking({
            user_id,
            api_date: new Date(),
            api_request: container_no,
            menu_id: api.name,
            api_status: "S",
            api_error: null,
            ip_config: req.ip || "127.0.0.1",
            ip_location: "System",
          });

          console.log(
            `Successfully found data using ${api.name} API with ${extractedEvents.length} events`
          );
          break; // Exit loop since we found data
        }
      } catch (apiError) {
        console.error(`Error with ${api.name} API:`, apiError.message);

        // Log failed attempt
        await Tracking.logTracking({
          user_id,
          api_date: new Date(),
          api_request: container_no,
          menu_id: api.name,
          api_status: "F",
          api_error: apiError.message,
          ip_config: req.ip || "127.0.0.1",
          ip_location: "System",
        });

        continue; // Try next API
      }
    }

    // If no data found from any API
    if (!trackingData) {
      return res.status(404).json({
        status: "error",
        message: "No tracking information found for this container number",
      });
    }

    // Extract status for response
    let currentStatus = "N/A";
    if (apiUsed === "AllForward") {
      currentStatus =
        trackingData.containerPosition?.data?.metadata?.status ||
        trackingData.containerPosition?.data?.containers?.[0]?.status ||
        "N/A";
    } else if (apiUsed === "SeaRates") {
      currentStatus =
        trackingData.data?.metadata?.status ||
        trackingData.data?.containers?.[0]?.status ||
        "N/A";
    } else if (apiUsed === "FindTeu") {
      currentStatus = trackingData.last?.status || "N/A";
    }

    // Generate PDF with tracking data
    console.log("Generating PDF for container:", container_no);
    const pdfBuffer = await generateTrackingPDF(
      trackingData,
      metadata,
      container_no,
      apiUsed
    );
    console.log("PDF generated successfully, size:", pdfBuffer.length, "bytes");

    // Send email with PDF attachment
    console.log("Sending email to:", email_to);
    try {
      await sendTrackingEmail({
        to: email_to,
        container_no,
        metadata,
        trackingData,
        pdfBuffer,
        apiUsed,
      });
      console.log("Email sent successfully");
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    // Get events count for response
    let responseEventsCount = 0;
    if (apiUsed === "AllForward") {
      responseEventsCount =
        trackingData.containerPosition?.data?.containers?.[0]?.events?.length ||
        0;
    } else if (apiUsed === "SeaRates") {
      responseEventsCount =
        trackingData.data?.containers?.[0]?.events?.length || 0;
    } else if (apiUsed === "FindTeu") {
      responseEventsCount = trackingData.events?.length || 0;
    }

    res.status(200).json({
      status: "success",
      message: `Ocean container tracking information found and email sent successfully using ${apiUsed}`,
      data: {
        container_no,
        email_to,
        api_used: apiUsed,
        events_count: responseEventsCount,
        tracking_status: currentStatus,
      },
    });
  } catch (error) {
    console.error("Error in trackContainerAndNotify:", error);

    // If next is available (API route), use it to send error
    if (typeof next === "function") {
      next(
        new AppError("Failed to track container and send notification", 500)
      );
    } else {
      // When called from cron job or other context, just throw
      throw new Error(
        "Failed to track container and send notification: " + error.message
      );
    }
  }
});

// Helper function to generate metadata from ocean tracking response (matches frontend exactly)
const generateOceanTrackingMetadata = (responseData, container_no, apiType) => {
  if (apiType === "ocean-af") {
    // AllForward API structure (matches frontend generateAfMetadata)
    const data = responseData.containerPosition?.data;
    const getLocationString = (locationId) => {
      const location = data?.locations?.find((l) => l.id === locationId);
      return location
        ? `${location.name}, ${location.state}, ${location.country}`
        : null;
    };

    return [
      { label: "TYPE", value: data?.metadata?.type || null },
      { label: "CONTAINER", value: data?.metadata?.number || null },
      { label: "SEALINE", value: data?.metadata?.sealine || null },
      { label: "SEALINE NAME", value: data?.metadata?.sealine_name || null },
      { label: "UPDATED AT", value: data?.metadata?.updated_at || null },
      { label: "FROM", value: getLocationString(data?.route?.pol?.location) },
      { label: "TO", value: getLocationString(data?.route?.pod?.location) },
      { label: "STATUS", value: data?.metadata?.status || null },
    ];
  } else if (apiType === "ocean-sr") {
    // SeaRates API structure (matches frontend generateSrMetadata)
    const data = responseData.data;
    const getLocationString = (locationId) => {
      const location = data?.locations?.find((l) => l.id === locationId);
      return location
        ? `${location.name}, ${location.state}, ${location.country}`
        : null;
    };

    return [
      { label: "Container", value: data?.metadata?.number || null },
      { label: "Sealine", value: data?.metadata?.sealine_name || null },
      { label: "Updated At", value: data?.metadata?.updated_at || null },
      { label: "FROM", value: getLocationString(data?.route?.pol?.location) },
      { label: "TO", value: getLocationString(data?.route?.pod?.location) },
      { label: "STATUS", value: data?.metadata?.status || null },
      { label: "ETA DEPARTURE", value: data?.route?.pol?.date || null },
      { label: "ETA ARRIVAL", value: data?.route?.pod?.date || null },
    ];
  } else if (apiType === "ocean-ft") {
    // FindTeu API structure (matches frontend generateFtMetadata)
    const statusValue =
      responseData.last?.status &&
      responseData.last?.port &&
      responseData.last?.date
        ? `${responseData.last.status}, ${responseData.last.port}, ${responseData.last.date}`
        : null;

    return [
      { label: "Container", value: responseData.container || null },
      { label: "Type", value: responseData.container_type || null },
      { label: "Updated At", value: responseData.updated_at || null },
      { label: "From", value: responseData.from?.port || null },
      { label: "To", value: responseData.to?.port || null },
      { label: "Status", value: statusValue },
      { label: "ETA DEPARTURE", value: responseData.from?.date || null },
      {
        label: "ETA ARRIVAL",
        value: responseData.estimated_time_of_arrival || null,
      },
    ];
  }

  return [];
};

// Helper function to generate PDF from tracking data
const generateTrackingPDF = async (
  trackingData,
  metadata,
  container_no,
  apiUsed
) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Determine API type from apiUsed name
    let apiType;
    if (apiUsed === "AllForward") apiType = "ocean-af";
    else if (apiUsed === "SeaRates") apiType = "ocean-sr";
    else if (apiUsed === "FindTeu") apiType = "ocean-ft";

    const htmlContent = generateTrackingHTML(
      trackingData,
      metadata,
      container_no,
      apiType
    );

    await page.setContent(htmlContent, {
      waitUntil: "networkidle0",
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20mm",
        right: "15mm",
        bottom: "20mm",
        left: "15mm",
      },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
};

// Helper function to generate HTML content for PDF and email (matches frontend exactly)
const generateTrackingHTML = (
  trackingData,
  metadata,
  container_no,
  apiType
) => {
  let events = [];
  let headers = [];

  // Helper functions (matching frontend)
  const getLocationString = (locationId, data) => {
    const location = data?.locations?.find((loc) => loc.id === locationId);
    return location ? `${location.name}, ${location.country}` : "";
  };

  const getFacilityString = (facilityId, data) => {
    const facility = data?.facilities?.find((fac) => fac.id === facilityId);
    return facility ? facility.name : "";
  };

  const getVesselInfo = (vesselId, voyageNumber, data) => {
    if (!vesselId) return { vesselVoyage: "", vesselImo: "" };
    const vessel = data?.vessels?.find((v) => v.id === vesselId);
    return {
      vesselVoyage: vessel ? `${vessel.name}, ${voyageNumber || ""}` : "",
      vesselImo: vessel?.imo || "",
    };
  };

  // Extract events and headers based on API type (matching frontend renderTableData)
  if (apiType === "ocean-af") {
    headers = [
      "ID",
      "DATE",
      "LOCATION",
      "FACILITY",
      "EVENT",
      "DESCRIPTION",
      "TYPE",
      "TRANSPORT TYPE",
      "VESSEL VOYAGE",
      "VESSEL IMO",
    ];
    const data = trackingData.containerPosition?.data;
    events =
      data?.containers?.[0]?.events?.map((event) => ({
        order_id: event?.order_id,
        date: formatDateTime(event?.date),
        location: getLocationString(event?.location, data),
        facility: getFacilityString(event?.facility, data),
        event: event?.event_type + " " + event?.event_code,
        description: event?.description,
        type: event?.type?.toLocaleUpperCase(),
        transportType: event?.transport_type,
        vesselVoyage: getVesselInfo(event?.vessel, event?.voyage, data)
          .vesselVoyage,
        vesselImo: getVesselInfo(event?.vessel, event?.voyage, data).vesselImo,
      })) || [];
  } else if (apiType === "ocean-sr") {
    headers = [
      "ID",
      "DATE",
      "LOCATION",
      "FACILITY",
      "EVENT",
      "DESCRIPTION",
      "TYPE",
      "TRANSPORT TYPE",
      "VESSEL VOYAGE",
      "VESSEL IMO",
    ];
    const data = trackingData.data;
    events =
      data?.containers?.[0]?.events?.map((event) => ({
        id: event?.order_id,
        date: formatDateTime(event?.date),
        location: getLocationString(event?.location, data),
        facility: getFacilityString(event?.facility, data),
        event: event?.event_type + " " + event?.event_code,
        description: event?.description,
        type: event?.type,
        transportType: event?.transport_type,
        vesselVoyage: getVesselInfo(event?.vessel, event?.voyage, data)
          .vesselVoyage,
        vesselImo: getVesselInfo(event?.vessel, event?.voyage, data).vesselImo,
      })) || [];
  } else if (apiType === "ocean-ft") {
    headers = ["DATE", "LOCATION", "FACILITY", "STATUS"];
    // Filter events to only show past events (matching frontend filter)
    events =
      trackingData.events
        ?.filter((event) => new Date(event?.date) < new Date())
        .map((event) => ({
          date: formatDateTime(event?.date),
          location: event?.location,
          facility: event?.port,
          status: event?.status,
        })) || [];
  }

  const metadataRows = metadata
    .filter(
      (item) =>
        item.value !== null && item.value !== undefined && item.value !== ""
    ) // Only show non-empty values
    .map(
      (item) =>
        `<tr>
        <td style="padding: 8px; border: 1px solid #e0e0e0; font-weight: 600; background-color: #f8fafc;">${
          item.label
        }</td>
        <td style="padding: 8px; border: 1px solid #e0e0e0;">${
          item.value || "N/A"
        }</td>
      </tr>`
    )
    .join("");

  const headerCells = headers.map((header) => `<th>${header}</th>`).join("");

  const eventRows = events
    .map((event, index) => {
      if (apiType === "ocean-af") {
        return `<tr style="border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.order_id}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.date}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.location}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.facility}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.event}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.description}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.type}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.transportType}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.vesselVoyage}</td>
            <td style="padding: 12px 8px;">${event.vesselImo}</td>
          </tr>`;
      } else if (apiType === "ocean-sr") {
        return `<tr style="border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.id}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.date}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.location}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.facility}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.event}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.description}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.type}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.transportType}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.vesselVoyage}</td>
            <td style="padding: 12px 8px;">${event.vesselImo}</td>
          </tr>`;
      } else if (apiType === "ocean-ft") {
        return `<tr style="border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.date}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.location}</td>
            <td style="padding: 12px 8px; border-right: 1px solid #e0e0e0;">${event.facility}</td>
            <td style="padding: 12px 8px;">${event.status}</td>
          </tr>`;
      }
      return "";
    })
    .join("");

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ocean Container Tracking Report - ${container_no}</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            color: #333;
            line-height: 1.6;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #3b82f6;
          }
          .company-name {
            font-size: 28px;
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 5px;
          }
          .report-title {
            font-size: 20px;
            color: #64748b;
            margin-bottom: 10px;
          }
          .container-number {
            font-size: 24px;
            font-weight: bold;
            color: #059669;
            background-color: #f0fdf4;
            padding: 10px 20px;
            border-radius: 8px;
            display: inline-block;
          }
          .section {
            margin: 30px 0;
          }
          .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e5e7eb;
          }
          .metadata-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          .events-table {
            width: 100%;
            border-collapse: collapse;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          .events-table th {
            background-color: #3b82f6;
            color: white;
            padding: 12px 8px;
            text-align: left;
            font-weight: 600;
            border-right: 1px solid #2563eb;
          }
          .events-table th:last-child {
            border-right: none;
          }
          .events-table tbody tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .events-table tbody tr:hover {
            background-color: #f1f5f9;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
          }
          .timestamp {
            margin-top: 10px;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">TrackWW</div>
          <div class="report-title">Ocean Container Tracking Report</div>
          <div class="container-number">${container_no}</div>
        </div>
  
        <div class="section">
          <div class="section-title">📋 Shipment Information</div>
          <table class="metadata-table">
            ${metadataRows}
          </table>
        </div>
  
        <div class="section">
          <div class="section-title">📦 Tracking Events</div>
          <table class="events-table">
            <thead>
              <tr>
                ${headerCells}
              </tr>
            </thead>
            <tbody>
              ${eventRows}
            </tbody>
          </table>
        </div>
  
        <div class="footer">
          <div>This report was generated automatically by TrackWW tracking system.</div>
          <div class="timestamp">Generated on: ${new Date().toLocaleString()}</div>
        </div>
      </body>
      </html>
    `;
};

// Helper function to format date/time
const formatDateTime = (datetime) => {
  if (!datetime) return "N/A";
  try {
    return new Date(datetime).toLocaleString();
  } catch (error) {
    return datetime.toString();
  }
};

// Helper function to send email with PDF attachment using Bravo service

const sendTrackingEmail = async ({
  to,
  container_no,
  metadata = [],
  trackingData = {},
  pdfBuffer,
  apiUsed,
}) => {
  console.log("📧 Preparing to send email via Bravo service");

  // --- Safeguards ---
  if (!to) throw new Error("Recipient email is missing");
  if (!container_no) throw new Error("Container number is missing");
  if (!pdfBuffer) {
    throw new Error("PDF buffer is missing");
  }

  // --- Extract tracking info ---
  let eventsCount = 0;
  let status = "N/A";

  try {
    switch (apiUsed) {
      case "AllForward":
        eventsCount =
          trackingData?.containerPosition?.data?.containers?.[0]?.events
            ?.length || 0;
        status =
          trackingData?.containerPosition?.data?.metadata?.status ||
          trackingData?.containerPosition?.data?.containers?.[0]?.status ||
          "N/A";
        break;

      case "SeaRates":
        eventsCount = trackingData?.data?.containers?.[0]?.events?.length || 0;
        status =
          trackingData?.data?.metadata?.status ||
          trackingData?.data?.containers?.[0]?.status ||
          "N/A";
        break;

      case "FindTeu":
        eventsCount = trackingData?.events?.length || 0;
        status = trackingData?.last?.status || "N/A";
        break;
    }
  } catch (err) {
    console.warn("⚠️ Error parsing tracking data:", err.message);
  }

  // --- Metadata table ---
  const metadataHTML = metadata
    .map(
      (item) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #e0e0e0; font-weight: 600; background-color: #f8fafc; width: 30%;">${item.label}</td>
            <td style="padding: 8px; border: 1px solid #e0e0e0; width: 70%;">${item.value}</td>
          </tr>`
    )
    .join("");

  // --- Email HTML ---
  const emailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #1e40af;">TrackWW - Container Tracking Notification</h2>
        <p>🎉 We found tracking info for <strong>${container_no}</strong></p>
        <p>📊 Data Source: ${apiUsed}<br>📦 Total Events: ${eventsCount}<br>📋 Status: ${status}</p>
        <h3>📋 Shipment Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">${metadataHTML}</table>
        <p>📎 A full PDF report is attached.</p>
        <hr>
        <p style="font-size: 12px; color: #666;">Generated on: ${new Date().toLocaleString()}</p>
      </div>
    `;

  // --- Bravo email payload ---
  const pdfBase64 = pdfBuffer.toString("base64");
  const bravoEmailData = {
    username: process.env.BRAVO_USERNAME,
    password: process.env.BRAVO_PASSWORD,
    to,
    subject: `🚢 Container Report - ${container_no}`,
    body: emailHTML,
    attachments: [
      {
        name: `container-${container_no}-${
          new Date().toISOString().split("T")[0]
        }.pdf`,
        content: pdfBase64,
        contentType: "application/pdf",
      },
    ],
  };

  // --- Send request ---
  try {
    const response = await axios.post(
      "https://bravo.aqza.com/api/mail/send",
      bravoEmailData,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 20000, // 20s
      }
    );

    if (response.status === 200 && response.data?.success) {
      console.log(`✅ Email sent to ${to} (container ${container_no})`);
      return true;
    } else {
      console.error("❌ Bravo service error:", response.data);
      return false;
    }
  } catch (error) {
    console.error("🚨 Email send failed:", error.message);

    if (error.response) {
      console.error("Bravo error response:", error.response.data);
    } else if (error.request) {
      console.error("No response from Bravo service");
    }

    return false; // Don’t throw; return failure so caller can retry
  }
};
