// externals: const_0, skipValue_0, readDouble_0, nanToZero_0, readNumberValue_0, Date_0, readInt64AsNumber_0, readDateValue_0, readInt64_0, readBigIntValue_0, readBinaryValue_0, readBSONStringDirect_0, readStringValue_0, skipCString_0, create_0, const_1, fn_0, fn_1, fn_2, fn_3, fn_4
'use strict';
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=const_0;
var at_6=const_0;
var big_7=const_0;
var bytes_8=const_0;
var title_9=const_0;
var until_10=const_0;
while(o_4<end_3){
    var type_11=buffer[o_4];
    o_4+=1;
    if(type_11===0){
        break;
    }
    if(buffer[o_4]===105&&buffer[(o_4+1)]===100&&buffer[(o_4+2)]===0){
        o_4+=3;
        if((type_11===10||type_11===6)){
            o_4=skipValue_0(buffer,o_4,type_11);
        }else{
            if(type_11===16){
                id_5=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                o_4+=4;
            }else{
                if(type_11===1){
                    var dblVal_18=readDouble_0(buffer,o_4);
                    id_5=nanToZero_0(dblVal_18);
                    o_4+=8;
                }else{
                    var numFallback_19=readNumberValue_0(buffer,o_4,type_11);
                    id_5=numFallback_19[0];
                    o_4+=numFallback_19[1];
                }
            }
        }
    }else{
        if(buffer[o_4]===97&&buffer[(o_4+1)]===116&&buffer[(o_4+2)]===0){
            o_4+=3;
            if((type_11===10||type_11===6)){
                o_4=skipValue_0(buffer,o_4,type_11);
            }else{
                if(type_11===9){
                    at_6=new Date_0(readInt64AsNumber_0(buffer,o_4));
                    o_4+=8;
                }else{
                    var dateResult_17=readDateValue_0(buffer,o_4,type_11);
                    at_6=dateResult_17[0];
                    o_4+=dateResult_17[1];
                }
            }
        }else{
            if(buffer[o_4]===98&&buffer[(o_4+1)]===105&&buffer[(o_4+2)]===103&&buffer[(o_4+3)]===0){
                o_4+=4;
                if((type_11===10||type_11===6)){
                    o_4=skipValue_0(buffer,o_4,type_11);
                }else{
                    if(type_11===18){
                        big_7=readInt64_0(buffer,o_4);
                        o_4+=8;
                    }else{
                        var bigintFallback_16=readBigIntValue_0(buffer,o_4,type_11);
                        big_7=bigintFallback_16[0];
                        o_4+=bigintFallback_16[1];
                    }
                }
            }else{
                if(buffer[o_4]===98&&buffer[(o_4+1)]===121&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===101&&buffer[(o_4+4)]===115&&buffer[(o_4+5)]===0){
                    o_4+=6;
                    if((type_11===10||type_11===6)){
                        o_4=skipValue_0(buffer,o_4,type_11);
                    }else{
                        var binResult_15=readBinaryValue_0(buffer,o_4,type_11);
                        bytes_8=binResult_15[0];
                        o_4+=binResult_15[1];
                    }
                }else{
                    if(buffer[o_4]===116&&buffer[(o_4+1)]===105&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===108&&buffer[(o_4+4)]===101&&buffer[(o_4+5)]===0){
                        o_4+=6;
                        if((type_11===10||type_11===6)){
                            o_4=skipValue_0(buffer,o_4,type_11);
                        }else{
                            if(type_11===2){
                                var strLen_13=(((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)))-1);
                                o_4+=4;
                                title_9=readBSONStringDirect_0(buffer,o_4,strLen_13);
                                o_4+=(strLen_13+1);
                            }else{
                                var strFallback_14=readStringValue_0(buffer,o_4,type_11);
                                title_9=strFallback_14[0];
                                o_4+=strFallback_14[1];
                            }
                        }
                    }else{
                        if(buffer[o_4]===117&&buffer[(o_4+1)]===110&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===105&&buffer[(o_4+4)]===108&&buffer[(o_4+5)]===0){
                            o_4+=6;
                            if((type_11===10||type_11===6)){
                                o_4=skipValue_0(buffer,o_4,type_11);
                                until_10=undefined;
                            }else{
                                if(type_11===9){
                                    until_10=new Date_0(readInt64AsNumber_0(buffer,o_4));
                                    o_4+=8;
                                }else{
                                    var dateResult_12=readDateValue_0(buffer,o_4,type_11);
                                    until_10=dateResult_12[0];
                                    o_4+=dateResult_12[1];
                                }
                            }
                        }else{
                            o_4=skipCString_0(buffer,o_4);
                            o_4=skipValue_0(buffer,o_4,type_11);
                        }
                    }
                }
            }
        }
    }
}
var result_20=create_0(const_1.prototype);
if(id_5!==const_0){
    result_20.id=id_5;
}else{
    result_20.id=fn_0();
}
if(at_6!==const_0){
    result_20.at=at_6;
}else{
    result_20.at=fn_1();
}
if(big_7!==const_0){
    result_20.big=big_7;
}else{
    result_20.big=fn_2();
}
if(bytes_8!==const_0){
    result_20.bytes=bytes_8;
}else{
    result_20.bytes=fn_3();
}
if(title_9!==const_0){
    result_20.title=title_9;
}else{
    result_20.title=fn_4();
}
if(until_10!==const_0){
    result_20.until=until_10;
}
return result_20;
}

// externals: const_0, readDouble_0, nanToZero_0, readNumberValue_0, const_1, Date_0, readInt64AsNumber_0, readDateValue_0, readInt64_0, readBigIntValue_0, readBinaryValue_0, readBSONStringDirect_0, readStringValue_0, fn_0, create_0, const_2, fn_1, fn_2, fn_3, fn_4, fn_5
'use strict';
function _nfn_0(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
}else{
    if(ft===16){
        val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
        ho_3+=4;
    }else{
        if(ft===1){
            var dblVal_5=readDouble_0(buffer,ho_3);
            val_4=nanToZero_0(dblVal_5);
            ho_3+=8;
        }else{
            var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
            val_4=numFallback_6[0];
            ho_3+=numFallback_6[1];
        }
    }
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_1(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===105&&buffer[(o+2)]===100&&buffer[(o+3)]===0){
        var do_4=(o+4);
        if(ft_3===16){
            const_1[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_1[1]=(do_4+4);
            return;
        }
        _nfn_0(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
function _nfn_2(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
}else{
    if(ft===9){
        val_4=new Date_0(readInt64AsNumber_0(buffer,ho_3));
        ho_3+=8;
    }else{
        var dateResult_5=readDateValue_0(buffer,ho_3,ft);
        val_4=dateResult_5[0];
        ho_3+=dateResult_5[1];
    }
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_3(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===97&&buffer[(o+2)]===116&&buffer[(o+3)]===0){
        var do_4=(o+4);
        if(ft_3===9){
            const_1[0]=new Date_0(readInt64AsNumber_0(buffer,do_4));
            const_1[1]=(do_4+8);
            return;
        }
        _nfn_2(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
function _nfn_4(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
}else{
    if(ft===18){
        val_4=readInt64_0(buffer,ho_3);
        ho_3+=8;
    }else{
        var bigintFallback_5=readBigIntValue_0(buffer,ho_3,ft);
        val_4=bigintFallback_5[0];
        ho_3+=bigintFallback_5[1];
    }
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_5(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===98&&buffer[(o+2)]===105&&buffer[(o+3)]===103&&buffer[(o+4)]===0){
        var do_4=(o+5);
        if(ft_3===18){
            const_1[0]=readInt64_0(buffer,do_4);
            const_1[1]=(do_4+8);
            return;
        }
        _nfn_4(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
function _nfn_6(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
}else{
    var binResult_5=readBinaryValue_0(buffer,ho_3,ft);
    val_4=binResult_5[0];
    ho_3+=binResult_5[1];
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_7(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===98&&buffer[(o+2)]===121&&buffer[(o+3)]===116&&buffer[(o+4)]===101&&buffer[(o+5)]===115&&buffer[(o+6)]===0){
        var do_4=(o+7);
        _nfn_6(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
function _nfn_8(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
}else{
    if(ft===2){
        var strLen_5=(((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)))-1);
        ho_3+=4;
        val_4=readBSONStringDirect_0(buffer,ho_3,strLen_5);
        ho_3+=(strLen_5+1);
    }else{
        var strFallback_6=readStringValue_0(buffer,ho_3,ft);
        val_4=strFallback_6[0];
        ho_3+=strFallback_6[1];
    }
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_9(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===116&&buffer[(o+2)]===105&&buffer[(o+3)]===116&&buffer[(o+4)]===108&&buffer[(o+5)]===101&&buffer[(o+6)]===0){
        var do_4=(o+7);
        if(ft_3===2){
            var strLen_5=(((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)))-1);
            var strStart_6=(do_4+4);
            const_1[0]=readBSONStringDirect_0(buffer,strStart_6,strLen_5);
            const_1[1]=(strStart_6+(strLen_5+1));
            return;
        }
        _nfn_8(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
function _nfn_10(buffer,o,ft){
var ho_3=o;
var val_4=const_0;
if((ft===10||ft===6)){
    val_4=undefined;
}else{
    if(ft===9){
        val_4=new Date_0(readInt64AsNumber_0(buffer,ho_3));
        ho_3+=8;
    }else{
        var dateResult_5=readDateValue_0(buffer,ho_3,ft);
        val_4=dateResult_5[0];
        ho_3+=dateResult_5[1];
    }
}
const_1[0]=val_4;
const_1[1]=ho_3;
return;
}
function _nfn_11(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===117&&buffer[(o+2)]===110&&buffer[(o+3)]===116&&buffer[(o+4)]===105&&buffer[(o+5)]===108&&buffer[(o+6)]===0){
        var do_4=(o+7);
        if(ft_3===9){
            const_1[0]=new Date_0(readInt64AsNumber_0(buffer,do_4));
            const_1[1]=(do_4+8);
            return;
        }
        _nfn_10(buffer,do_4,ft_3);
        return;
    }
}
const_1[0]=const_0;
const_1[1]=o;
}
return function(buffer,offset=0){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=const_0;
var at_6=const_0;
var big_7=const_0;
var bytes_8=const_0;
var title_9=const_0;
var until_10=const_0;
_nfn_1(buffer,o_4,end_3);
id_5=const_1[0];
o_4=const_1[1];
_nfn_3(buffer,o_4,end_3);
at_6=const_1[0];
o_4=const_1[1];
_nfn_5(buffer,o_4,end_3);
big_7=const_1[0];
o_4=const_1[1];
_nfn_7(buffer,o_4,end_3);
bytes_8=const_1[0];
o_4=const_1[1];
_nfn_9(buffer,o_4,end_3);
title_9=const_1[0];
o_4=const_1[1];
_nfn_11(buffer,o_4,end_3);
until_10=const_1[0];
o_4=const_1[1];
if(buffer[o_4]!==0){
    return fn_0(buffer,offset);
}
var result_11=create_0(const_2.prototype);
if(id_5!==const_0){
    result_11.id=id_5;
}else{
    result_11.id=fn_1();
}
if(at_6!==const_0){
    result_11.at=at_6;
}else{
    result_11.at=fn_2();
}
if(big_7!==const_0){
    result_11.big=big_7;
}else{
    result_11.big=fn_3();
}
if(bytes_8!==const_0){
    result_11.bytes=bytes_8;
}else{
    result_11.bytes=fn_4();
}
if(title_9!==const_0){
    result_11.title=title_9;
}else{
    result_11.title=fn_5();
}
if(until_10!==const_0){
    result_11.until=until_10;
}
return result_11;
}
