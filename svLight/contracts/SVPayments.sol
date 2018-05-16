pragma solidity ^0.4.24;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { permissioned } from "./SVCommon.sol";
import "./IndexInterface.sol";


contract SVPayments is IxPaymentsIface, permissioned {
    event PaymentEnabled(bool feeEnabled);
    event UpgradedToPremium(bytes32 indexed democHash);
    event GrantedAccountTime(bytes32 indexed democHash, uint additionalSeconds, bytes32 ref);
    event AccountPayment(bytes32 indexed democHash, uint additionalSeconds);
    event SetCommunityBallotFee(uint amount);
    event SetBasicCentsPricePer30Days(uint amount);
    event SetPremiumMultiplier(uint8 multiplier);
    event DowngradeToBasic(bytes32 indexed democHash);
    event UpgradeToPremium(bytes32 indexed democHash);
    event SetExchangeRate(uint weiPerCent);


    struct Account {
        bool isPremium;
        uint lastPaymentTs;
        uint paidUpTill;
    }

    struct PaymentLog {
        bool _external;
        bytes32 _democHash;
        uint _seconds;
        uint _ethValue;
    }


    // payment details
    address public payTo;
    bool paymentEnabled = true;
    uint communityBallotCentsPrice = 1000;  // $10/ballot
    uint basicCentsPricePer30Days = 100000; // $1000/mo
    uint8 premiumMultiplier = 5;
    uint weiPerCent = 0.00001390434 ether;  // $719.20, 13:00 May 14th AEST
    // this allows us to set an address that's allowed to update the exchange rate
    address exchangeRateAddr;

    mapping (bytes32 => Account) accounts;
    PaymentLog[] payments;


    modifier owner_or(address addr) {
        require(msg.sender == addr || msg.sender == owner, "403 when sending from this address");
        _;
    }


    constructor() permissioned() public {
        payTo = msg.sender;
    }

    function() payable public {
        // check gas because we need to look up payTo
        if (gasleft() > 25000) {
            payTo.transfer(msg.value);
        }
    }

    function _modAccountBalance(bytes32 democHash, uint additionalSeconds) internal {
        uint prevPaidTill = accounts[democHash].paidUpTill;
        if (prevPaidTill < now) {
            prevPaidTill = now;
        }

        accounts[democHash].paidUpTill = prevPaidTill + additionalSeconds;
        accounts[democHash].lastPaymentTs = now;
    }

    function payForDemocracy(bytes32 democHash) external payable {
        require(msg.value > 0, "need to send some ether to make payment");

        uint centsPaid = weiToCents(msg.value);
        // multiply by 10^18 to ensure we make rounding errors insignificant
        uint monthRatioOffsetPaid = (10^18) * centsPaid / basicCentsPricePer30Days;
        uint secondsOffsetPaid = monthRatioOffsetPaid * 30 days;
        uint additionalSeconds = secondsOffsetPaid / (10^18);

        if (accounts[democHash].isPremium) {
            additionalSeconds /= premiumMultiplier;
        }

        _modAccountBalance(democHash, additionalSeconds);
        payments.push(PaymentLog(false, democHash, additionalSeconds, msg.value));
        emit AccountPayment(democHash, additionalSeconds);

        payTo.transfer(msg.value);
    }

    function accountInGoodStanding(bytes32 democHash) external view returns (bool) {
        return accounts[democHash].paidUpTill >= now;
    }

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) only_owner() external {
        _modAccountBalance(democHash, additionalSeconds);
        payments.push(PaymentLog(true, democHash, additionalSeconds, 0));
        emit GrantedAccountTime(democHash, additionalSeconds, ref);
    }

    function upgradeToPremium(bytes32 democHash) only_editors() external {
        require(!accounts[democHash].isPremium, "cannot upgrade to premium twice");
        accounts[democHash].isPremium = true;
        // convert basic minutes to premium minutes
        uint timeRemaining = accounts[democHash].paidUpTill - now;
        // if we have time remaning then convert it - otherwise don't need to do anything
        if (timeRemaining > 0) {
            timeRemaining /= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        emit UpgradedToPremium(democHash);
    }

    function downgradeToBasic(bytes32 democHash) only_editors() external {
        require(accounts[democHash].isPremium, "must be premium to downgrade");
        accounts[democHash].isPremium = false;
        // convert premium minutes to basic
        uint timeRemaining = accounts[democHash].paidUpTill - now;
        // if we have time remaining: convert it
        if (timeRemaining > 0) {
            timeRemaining *= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        emit DowngradeToBasic(democHash);
    }

    function payoutAll() external {
        payTo.transfer(address(this).balance);
    }

    //* PAYMENT AND OWNER FUNCTIONS */

    function setPayTo(address newPayTo) only_owner() external {
        payTo = newPayTo;
    }

    function setPaymentEnabled(bool _enabled) only_owner() external {
        paymentEnabled = _enabled;
        emit PaymentEnabled(_enabled);
    }

    function setCommunityBallotCentsPrice(uint amount) only_owner() external {
        communityBallotCentsPrice = amount;
        emit SetCommunityBallotFee(amount);
    }

    function setBasicCentsPricePer30Days(uint amount) only_owner() external {
        basicCentsPricePer30Days = amount;
        emit SetBasicCentsPricePer30Days(amount);
    }

    function setPremiumMultiplier(uint8 m) only_owner() external {
        premiumMultiplier = m;
        emit SetPremiumMultiplier(m);
    }

    function setWeiPerCent(uint wpc) owner_or(exchangeRateAddr) external {
        weiPerCent = wpc;
        emit SetExchangeRate(wpc);
    }


    /* Getters */

    function getPayTo() external view returns(address) {
        return payTo;
    }

    function getPaymentEnabled() external view returns (bool) {
        return paymentEnabled;
    }

    function getCommunityBallotCentsPrice() external view returns(uint) {
        return communityBallotCentsPrice;
    }

    function getBasicCentsPricePer30Days() external view returns(uint) {
        return basicCentsPricePer30Days;
    }

    function getPremiumMultiplier() external view returns (uint8) {
        return premiumMultiplier;
    }

    function getPremiumPricePer30Days() external view returns (uint) {
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

    function weiToCents(uint w) internal view returns (uint) {
        return weiPerCent / w;
    }

    function centsToWei(uint c) internal view returns (uint) {
        return c * weiPerCent;
    }
}
