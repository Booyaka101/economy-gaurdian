-- EconomyGuardian_Accounting - Link helper
-- Prints a dashboard link containing current realm/character on login

local addonName = ...
local f = CreateFrame("Frame")
f:RegisterEvent("PLAYER_LOGIN")

local function urlEncode(s)
  if not s then return "" end
  s = tostring(s)
  s = s:gsub(" ", "%%20")
  s = s:gsub("[<>\"'%%]", function(c)
    return string.format("%%%02X", string.byte(c))
  end)
  return s
end

local function getBaseUrl()
  local b = (type(EG_ConfigDB) == "table" and EG_ConfigDB.baseUrl) or "http://localhost:3000"
  if type(b) ~= "string" or b == "" then b = "http://localhost:3000" end
  b = b:gsub("/+$", "")
  return b
end

local function printLink()
  local name, realm = UnitFullName("player")
  if not name then return end
  realm = realm or GetRealmName() or ""
  local q = string.format("realm=%s&character=%s", urlEncode(realm), urlEncode(name))
  -- Base path and a default localhost URL (adjust port if your companion runs on a different port)
  local path = "/player.html?" .. q
  local full = getBaseUrl() .. path
  DEFAULT_CHAT_FRAME:AddMessage(string.format("|cff00ff88[EG]|r Player dashboard link: %s", full))
  DEFAULT_CHAT_FRAME:AddMessage(string.format("|cff00ff88[EG]|r To change: /eg port <num> or /eg base <url>"))
end

f:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGIN" then
    C_Timer.After(2, printLink) -- slight delay so chat is visible
  end
end)

