local ADDON, ns = ...

EG_AccountingDB = EG_AccountingDB or { version = 1, realms = {} }
EG_ConfigDB = EG_ConfigDB or { baseUrl = "http://localhost:4317" }

local function getBaseUrl()
  local b = (type(EG_ConfigDB) == "table" and EG_ConfigDB.baseUrl) or "http://localhost:4317"
  if type(b) ~= "string" or b == "" then b = "http://localhost:4317" end
  b = b:gsub("/+$", "")
  return b
end

local function urlEncode(s)
  if not s then return "" end
  s = tostring(s)
  s = s:gsub(" ", "%%20")
  s = s:gsub("[<>\"'%%]", function(c) return string.format("%%%02X", string.byte(c)) end)
  return s
end

local function compUrl(path)
  return getBaseUrl() .. path
end

local function now()
  return time()
end

local function playerIdentity()
  local name, realm = UnitFullName("player")
  name = name or UnitName("player") or "Unknown"
  realm = realm or GetRealmName() or "UnknownRealm"
  return name, realm
end

local function ensureChar()
  local name, realm = playerIdentity()
  EG_AccountingDB.realms[realm] = EG_AccountingDB.realms[realm] or {}
  EG_AccountingDB.realms[realm][name] = EG_AccountingDB.realms[realm][name] or {
    postings = {}, sales = {}, payouts = {}, cancels = {}, expires = {}
  }
  return EG_AccountingDB.realms[realm][name]
end

local function push(tbl, row)
  tbl[#tbl+1] = row
end

-- Keep tables from growing without bound
local function trimTail(tbl, max)
  max = max or 5000
  local n = #tbl
  if n > max then
    local drop = n - max
    for i = 1, drop do tbl[i] = nil end
    -- compact array (Lua arrays are 1..n; shifting is implicit once leading nils added)
    local j = 1
    local new = {}
    for i = 1, #tbl do if tbl[i] ~= nil then new[j] = tbl[i]; j = j + 1 end end
    return new
  end
  return tbl
end

-- Parse coin string to copper if needed (fallback to number)
local function toCopper(v)
  if type(v) == "number" then return v end
  if type(v) == "string" then
    -- Simple numeric string
    local num = tonumber(v)
    if num then return num end
  end
  return 0
end

-- Extract itemId from an item link inside arbitrary text
local function extractItemIdFromText(s)
  if type(s) ~= "string" then return nil end
  local id = s:match("Hitem:(%d+)")
  return id and tonumber(id) or nil
end

-- Build a Lua pattern from a GlobalString template like "... %s ..."
local function makePattern(fmt)
  if type(fmt) ~= "string" or fmt == "" then return nil end
  local pat = fmt
  -- escape Lua pattern magic chars
  pat = pat:gsub("([%(%)%.%+%-%*%?%[%^%$])", "%%%1")
  -- replace '%s' placeholder with a capturing group
  pat = pat:gsub("%%s", "(.+)")
  return pat
end

local PAT = {
  sold      = makePattern(_G.ERR_AUCTION_SOLD_S),
  expired   = makePattern(_G.ERR_AUCTION_EXPIRED_S),
  cancelled = makePattern(_G.ERR_AUCTION_REMOVED_S),
  won       = makePattern(_G.ERR_AUCTION_WON_S),
}

-- Event frame
local f = CreateFrame("Frame")

-- Track sales via system chat messages
-- e.g., GLOBAL_STRING: ERR_AUCTION_SOLD_S: "A buyer has been found for your auction of %s."
local function handleSystemMsg(msg)
  if not msg or msg == "" then return end
  local db = ensureChar()
  -- Sold
  repeat
    if PAT.sold and msg:match(PAT.sold) then
      local captured = msg:match(PAT.sold)
      local itemId = extractItemIdFromText(captured) or extractItemIdFromText(msg)
      push(db.sales, { t = now(), itemId = itemId, qty = 1, unit = 0, source = "chat" })
      break
    end
    -- Expired
    if PAT.expired and msg:match(PAT.expired) then
      local captured = msg:match(PAT.expired)
      local itemId = extractItemIdFromText(captured) or extractItemIdFromText(msg)
      push(db.expires, { t = now(), itemId = itemId })
      break
    end
    -- Cancelled/Cancelled
    if PAT.cancelled and msg:match(PAT.cancelled) then
      local captured = msg:match(PAT.cancelled)
      local itemId = extractItemIdFromText(captured) or extractItemIdFromText(msg)
      push(db.cancels, { t = now(), itemId = itemId })
      break
    end
    -- Bought (won)
    if PAT.won and msg:match(PAT.won) then
      local captured = msg:match(PAT.won)
      local itemId = extractItemIdFromText(captured) or extractItemIdFromText(msg)
      db.buys = db.buys or {}
      push(db.buys, { t = now(), itemId = itemId, qty = 1, unit = 0, source = "chat" })
      break
    end
  until true
end

-- Track payouts by scanning mailbox headers
local function scanMail()
  if not MailFrame or not InboxFrame then return end
  local db = ensureChar()
  local num = GetInboxNumItems() or 0
  for i = 1, num do
    local _, _, sender, subject, money = GetInboxHeaderInfo(i)
    if sender and subject then
      local invoiceType, itemName, playerName, bid, buyout, deposit, consignment = GetInboxInvoiceInfo(i)
      if invoiceType == "seller" then
        local net = toCopper(money or 0)
        local cut = toCopper(consignment or 0)
        local gross = net + cut
        -- Auction House payout mails generally have no attachments.
        -- Avoid calling GetInboxItem/GetInboxItemLink which require an attachment index.
        local qty = 0
        local itemId = nil
        -- We still record the itemName from the invoice info when available.
        push(db.payouts, { t = now(), net = net, gross = gross, cut = cut, itemId = itemId, qty = qty, itemName = itemName })
      end
    end
  end
  -- Trim buckets
  db.postings = trimTail(db.postings)
  db.sales    = trimTail(db.sales)
  db.payouts  = trimTail(db.payouts)
  db.cancels  = trimTail(db.cancels)
  db.expires  = trimTail(db.expires)
  if db.buys then db.buys = trimTail(db.buys) end
end

-- Attempt to capture posting actions by hooking the Post button;
-- we won't automate, only log the intention.
local function hookPost()
  if AuctionHouseFrame and AuctionHouseFrame.PostButton and not ns._postHooked then
    ns._postHooked = true
    AuctionHouseFrame.PostButton:HookScript("OnClick", function()
      local db = ensureChar()
      -- Try to read price/stack from the sell frame APIs if available
      local price = 0
      local quantity = 0
      if C_AuctionHouse and C_AuctionHouse.GetItemSellInfo then
        local info = C_AuctionHouse.GetItemSellInfo()
        if info then
          price = tonumber(info.unitPrice) or 0
          quantity = tonumber(info.quantity) or 0
        end
      end
      push(db.postings, { t = now(), unit = price, qty = quantity })
    end)
  end
end

f:SetScript("OnEvent", function(self, event, ...)
  if event == "PLAYER_LOGIN" then
    ensureChar()
    hookPost()
  elseif event == "CHAT_MSG_SYSTEM" then
    local msg = ...
    handleSystemMsg(msg)
  elseif event == "MAIL_INBOX_UPDATE" then
    scanMail()
  elseif event == "AUCTION_HOUSE_SHOW" then
    C_Timer.After(1.0, hookPost)
  end
end)

f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("CHAT_MSG_SYSTEM")
f:RegisterEvent("MAIL_INBOX_UPDATE")
f:RegisterEvent("AUCTION_HOUSE_SHOW")

-- Slash command to show quick counts
SLASH_EGACC1 = "/egacc"
SlashCmdList["EGACC"] = function(msg)
  local name, realm = playerIdentity()
  local c = ensureChar()
  print(string.format(
    "EG Accounting [%s-%s]: postings=%d sales=%d payouts=%d cancels=%d expires=%d buys=%d",
    name, realm, #c.postings, #c.sales, #c.payouts, #c.cancels, #c.expires, #(c.buys or {})
  ))
end

-- Minimal AI entrypoint: /eg ai [itemId]
SLASH_EG1 = "/eg"
SlashCmdList["EG"] = function(msg)
  msg = (msg or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local lower = msg:lower()
  if lower:match("^ai") then
    local item = tonumber((lower:match("ai%s+(%d+)") or ""))
    if item then
      local url = compUrl("/ai.html?itemId=" .. tostring(item))
      print(string.format("|cff00ff88[EG]|r AI — Smart Price Advisor for item %d: %s", item, url))
    else
      local url = compUrl("/ai.html")
      print(string.format("|cff00ff88[EG]|r AI — Open: %s", url))
      print("Tip: '/eg ai 19019' to target a specific item ID.")
    end
  elseif lower:match("^player") then
    local name, realm = UnitFullName("player")
    realm = realm or GetRealmName() or ""
    local q = string.format("realm=%s&character=%s", urlEncode(realm), urlEncode(name or ""))
    print(string.format("|cff00ff88[EG]|r Player Dashboard: %s", compUrl("/player.html?" .. q)))
  elseif lower:match("^port%s+") then
    local port = tonumber((lower:match("port%s+(%d+)") or ""))
    if port and port > 0 then
      EG_ConfigDB.baseUrl = string.format("http://localhost:%d", port)
      print(string.format("|cff00ff88[EG]|r Set companion base URL to %s", EG_ConfigDB.baseUrl))
    else
      print("Usage: /eg port 4317")
    end
  elseif lower:match("^base%s+") then
    local rest = msg:match("^base%s+(.+)$")
    if rest and rest ~= "" then
      EG_ConfigDB.baseUrl = rest
      print(string.format("|cff00ff88[EG]|r Set companion base URL to %s", EG_ConfigDB.baseUrl))
    else
      print("Usage: /eg base http://localhost:4317")
    end
  elseif lower == "" or lower == "help" then
    print("EG: Commands — /eg ai [itemId], /eg player, /eg port <num>, /eg base <url>. Use '/egacc' for accounting summary.")
  else
    print("EG: Unknown command. Try '/eg help'.")
  end
end
