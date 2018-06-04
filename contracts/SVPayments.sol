pragma solidity ^0.4.24;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { permissioned, payoutAllC } from "./SVCommon.sol";
import "./IndexInterface.sol";


library SafeMath {

    function subToZero(uint a, uint b) internal pure returns (uint) {
        if (a < b) {  // then (a - b) would overflow
            return 0;
        }
        return a - b;
    }

}



contract SVPayments is IxPaymentsIface, permissioned, payoutAllC {
    event UpgradedToPremium(bytes32 indexed democHash);
    event GrantedAccountTime(bytes32 indexed democHash, uint additionalSeconds, bytes32 ref);
    event AccountPayment(bytes32 indexed democHash, uint additionalSeconds);
    event SetCommunityBallotFee(uint amount);
    event SetBasicCentsPricePer30Days(uint amount);
    event SetPremiumMultiplier(uint8 multiplier);
    event DowngradeToBasic(bytes32 indexed democHash);
    event UpgradeToPremium(bytes32 indexed democHash);
    event SetExchangeRate(uint weiPerCent);
    event FreeExtension(bytes32 democHash);


    struct Account {
        bool isPremium;
        uint lastPaymentTs;
        uint paidUpTill;
        uint lastUpgradeTs;  // timestamp of the last time it was upgraded to premium
    }

    struct PaymentLog {
        bool _external;
        bytes32 _democHash;
        uint _seconds;
        uint _ethValue;
    }

    // this is an address that's only allowed to make minor edits
    // e.g. setExchangeRate, setDenyPremium, giveTimeToDemoc
    address public minorEditsAddr;

    // payment details
    uint communityBallotCentsPrice = 1000;  // $10/ballot
    uint basicCentsPricePer30Days = 100000; // $1000/mo
    uint basicBallotsPer30Days = 5;
    uint8 premiumMultiplier = 5;
    uint weiPerCent = 0.000018975332 ether;  // $527, 14:00 May 29th AEST

    mapping (bytes32 => Account) accounts;
    PaymentLog[] payments;

    mapping (bytes32 => bool) denyPremium;
    // this is used for non-profits or organisations that have perpetual licenses, etc
    mapping (bytes32 => bool) freeExtension;

    modifier owner_or(address addr) {
        require(msg.sender == addr || msg.sender == owner, "!owner-or");
        _;
    }


    /* BREAK GLASS IN CASE OF EMERGENCY */
    // this is included here because something going wrong with payments is possibly
    // the absolute worst case. Note: does this have negligable benefit if the other
    // contracts are compromised? (e.g. by a leaked privkey)
    address public emergencyAdmin;
    function emergencySetOwner(address newOwner) external {
        require(msg.sender == emergencyAdmin, "!emergency-owner");
        owner = newOwner;
    }
    /* END BREAK GLASS */


    constructor(address _emergencyAdmin) public {
        emergencyAdmin = _emergencyAdmin;
        require(_emergencyAdmin != address(0), "backup-admin-null");
    }

    function() payable public {
        _payTo.transfer(msg.value);
    }

    function _modAccountBalance(bytes32 democHash, uint additionalSeconds) internal {
        uint prevPaidTill = accounts[democHash].paidUpTill;
        if (prevPaidTill < now) {
            prevPaidTill = now;
        }

        accounts[democHash].paidUpTill = prevPaidTill + additionalSeconds;
        accounts[democHash].lastPaymentTs = now;
    }

    function weiBuysHowManySeconds(uint amount) public view returns (uint) {
        uint centsPaid = weiToCents(amount);
        // multiply by 10**18 to ensure we make rounding errors insignificant
        uint monthsOffsetPaid = ((10 ** 18) * centsPaid) / basicCentsPricePer30Days;
        uint secondsOffsetPaid = monthsOffsetPaid * (30 days);
        uint additionalSeconds = secondsOffsetPaid / (10 ** 18);
        return additionalSeconds;
    }

    function payForDemocracy(bytes32 democHash) external payable {
        require(msg.value > 0, "need to send some ether to make payment");

        uint additionalSeconds = weiBuysHowManySeconds(msg.value);

        if (accounts[democHash].isPremium) {
            additionalSeconds /= premiumMultiplier;
        }

        if (additionalSeconds >= 1) {
            _modAccountBalance(democHash, additionalSeconds);
        }
        payments.push(PaymentLog(false, democHash, additionalSeconds, msg.value));
        emit AccountPayment(democHash, additionalSeconds);

        _payTo.transfer(msg.value);
    }

    function accountInGoodStanding(bytes32 democHash) external view returns (bool) {
        return accounts[democHash].paidUpTill >= now;
    }

    function getSecondsRemaining(bytes32 democHash) external view returns (uint) {
        return SafeMath.subToZero(accounts[democHash].paidUpTill, now);
    }

    function getPremiumStatus(bytes32 democHash) external view returns (bool) {
        return accounts[democHash].isPremium;
    }

    function getFreeExtension(bytes32 democHash) external view returns (bool) {
        return freeExtension[democHash];
    }

    function getAccount(bytes32 democHash) external view returns (bool isPremium, uint lastPaymentTs, uint paidUpTill, bool hasFreeExtension) {
        isPremium = accounts[democHash].isPremium;
        lastPaymentTs = accounts[democHash].lastPaymentTs;
        paidUpTill = accounts[democHash].paidUpTill;
        hasFreeExtension = freeExtension[democHash];
    }

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) owner_or(minorEditsAddr) external {
        _modAccountBalance(democHash, additionalSeconds);
        payments.push(PaymentLog(true, democHash, additionalSeconds, 0));
        emit GrantedAccountTime(democHash, additionalSeconds, ref);
    }

    function doFreeExtension(bytes32 democHash) external {
        require(freeExtension[democHash], "!free");
        uint newPaidUpTill = now + 60 days;
        accounts[democHash].paidUpTill = newPaidUpTill;
        emit FreeExtension(democHash);
    }

    function upgradeToPremium(bytes32 democHash) only_editors() external {
        require(denyPremium[democHash] == false, "upgrade-denied");
        require(!accounts[democHash].isPremium, "!basic");
        accounts[democHash].isPremium = true;
        // convert basic minutes to premium minutes
        uint paidTill = accounts[democHash].paidUpTill;
        uint timeRemaining = SafeMath.subToZero(paidTill, now);
        // if we have time remaning then convert it - otherwise don't need to do anything
        if (timeRemaining > 0) {
            timeRemaining /= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        accounts[democHash].lastUpgradeTs = now;
        emit UpgradedToPremium(democHash);
    }

    function downgradeToBasic(bytes32 democHash) only_editors() external {
        require(accounts[democHash].isPremium, "!premium");
        accounts[democHash].isPremium = false;
        // convert premium minutes to basic
        uint paidTill = accounts[democHash].paidUpTill;
        uint timeRemaining = SafeMath.subToZero(paidTill, now);
        // if we have time remaining: convert it
        if (timeRemaining > 0) {
            // prevent accounts from downgrading if they have time remaining
            // and upgraded less than 24hrs ago
            require(accounts[democHash].lastUpgradeTs < (now - 24 hours), "downgrade-too-soon");
            timeRemaining *= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        emit DowngradeToBasic(democHash);
    }

    //* PAYMENT AND OWNER FUNCTIONS */

    function setPayTo(address newPayTo) only_owner() external {
        _payTo = newPayTo;
    }

    function setCommunityBallotCentsPrice(uint amount) only_owner() external {
        communityBallotCentsPrice = amount;
        emit SetCommunityBallotFee(amount);
    }

    function setBasicCentsPricePer30Days(uint amount) only_owner() external {
        basicCentsPricePer30Days = amount;
        emit SetBasicCentsPricePer30Days(amount);
    }

    function setBasicBallotsPer30Days(uint amount) only_owner() external {
        basicBallotsPer30Days = amount;
    }

    function setPremiumMultiplier(uint8 m) only_owner() external {
        premiumMultiplier = m;
        emit SetPremiumMultiplier(m);
    }

    function setWeiPerCent(uint wpc) owner_or(minorEditsAddr) external {
        weiPerCent = wpc;
        emit SetExchangeRate(wpc);
    }

    function setFreeExtension(bytes32 democHash, bool hasFreeExt) owner_or(minorEditsAddr) external {
        freeExtension[democHash] = hasFreeExt;
    }

    function setMinorEditsAddr(address a) only_owner() external {
        minorEditsAddr = a;
    }

    function setDenyPremium(bytes32 democHash, bool isPremiumDenied) owner_or(minorEditsAddr) external {
        denyPremium[democHash] = isPremiumDenied;
    }


    /* Getters */

    function getPayTo() external view returns (address) {
        return _payTo;
    }

    function getCommunityBallotCentsPrice() external view returns (uint) {
        return communityBallotCentsPrice;
    }

    function getCommunityBallotWeiPrice() external view returns (uint) {
        return centsToWei(communityBallotCentsPrice);
    }

    function getBasicCentsPricePer30Days() external view returns (uint) {
        return basicCentsPricePer30Days;
    }

    function getBasicExtraBallotFeeWei() external view returns (uint) {
        return centsToWei(basicCentsPricePer30Days / basicBallotsPer30Days);
    }

    function getBasicBallotsPer30Days() external view returns (uint) {
        return basicBallotsPer30Days;
    }

    function getPremiumMultiplier() external view returns (uint8) {
        return premiumMultiplier;
    }

    function getPremiumCentsPricePer30Days() external view returns (uint) {
        return _premiumPricePer30Days();
    }

    function _premiumPricePer30Days() internal view returns (uint) {
        return uint(premiumMultiplier) * basicCentsPricePer30Days;
    }

    function getWeiPerCent() external view returns (uint) {
        return weiPerCent;
    }

    function getUsdEthExchangeRate() external view returns (uint) {
        // this returns cents per ether
        return 1 ether / weiPerCent;
    }

    function getDenyPremium(bytes32 democHash) external view returns (bool) {
        return denyPremium[democHash];
    }

    function getPaymentLogN() external view returns (uint) {
        return payments.length;
    }

    function getPaymentLog(uint n) external view returns (bool _external, bytes32 _democHash, uint _seconds, uint _ethValue) {
        _external = payments[n]._external;
        _democHash = payments[n]._democHash;
        _seconds = payments[n]._seconds;
        _ethValue = payments[n]._ethValue;
    }


    /* payment util functions */

    function weiToCents(uint w) public view returns (uint) {
        return w / weiPerCent;
    }

    function centsToWei(uint c) public view returns (uint) {
        return c * weiPerCent;
    }
}
